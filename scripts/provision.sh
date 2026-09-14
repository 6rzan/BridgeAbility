#!/usr/bin/env bash
#
# Stands up everything this application needs, from a fresh AWS Academy lab session: the RDS
# instance, both DynamoDB tables, and the S3 bucket. Does NOT create the Elastic Beanstalk
# environment itself -- that stays a deliberate, explicit `eb create` (see README.md#deploying)
# because it is the one step that needs a human decision (the environment name) and because
# `eb create` is already the documented, working path.
#
# WHY THIS SCRIPT EXISTS
#
# AWS Academy issues a brand-new sandbox account on every lab reset. Nothing provisioned in a
# previous session survives it -- not the RDS instance, not the DynamoDB tables, not the S3
# bucket. Re-provisioning by hand through the console cost real session time the first few
# times this happened (see docs/task2-plan.md, the misdiagnosed-expiry entry). This script is
# that lost time paid once, so every later lab reset costs one command.
#
# Idempotent throughout: safe to re-run if it is interrupted partway, and safe to run again
# against a session where some of this already exists.
#
# WHY NOTHING IS HARDCODED
#
# Every ID below is per-lab-session and per-member (CLAUDE.md: "config is env-driven with zero
# literals", the same rule .ebextensions/02-options.config follows for the same reason). This
# script fails fast and names exactly which variable is missing, rather than silently reusing
# a stale ID from someone else's session.
#
# Usage:
#   VPC_ID=vpc-xxxx \
#   SUBNET_IDS=subnet-a,subnet-b,subnet-c \
#   APP_SECURITY_GROUP_ID=sg-xxxx \
#   S3_BUCKET=bridgeability-media-<your-tp-number> \
#   DB_PASSWORD='a strong password, 8-41 characters, no @ / " or spaces' \
#   AWS_REGION=us-east-1 \
#     bash scripts/provision.sh
#
# Find VPC_ID / SUBNET_IDS from your current lab session with:
#   aws ec2 describe-vpcs --query 'Vpcs[0].VpcId'
#   aws ec2 describe-subnets --filters Name=vpc-id,Values=<vpc-id> --query 'Subnets[].SubnetId'
# APP_SECURITY_GROUP_ID is whichever security group you pass to `eb create --vpc.securitygroups`
# (see README.md#deploying) -- it must exist before this script runs, since the RDS security
# group this script creates admits 3306 from it by reference, not by CIDR.
#
# Prints DB_HOST, S3_BUCKET, DDB_TIMELINE_TABLE and DDB_SESSIONS_TABLE at the end -- copy those
# into the Elastic Beanstalk environment properties (`eb setenv` or the console), never into a
# tracked file.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
region="${AWS_REGION:-us-east-1}"

require() {
  local var_name="$1"
  if [[ -z "${!var_name:-}" ]]; then
    echo "provision: $var_name is not set. See the usage comment at the top of this script." >&2
    exit 1
  fi
}

require VPC_ID
require SUBNET_IDS
require APP_SECURITY_GROUP_ID
require S3_BUCKET
require DB_PASSWORD

db_instance_id="${RDS_INSTANCE_ID:-bridgeability-db}"
db_name="${DB_NAME:-bridgeability}"
db_user="${DB_USER:-bridgeability_app}"
db_instance_class="${RDS_INSTANCE_CLASS:-db.t3.micro}"
db_engine_version="${RDS_ENGINE_VERSION:-8.0.43}"
db_allocated_storage="${RDS_ALLOCATED_STORAGE:-20}"
rds_sg_name="${RDS_SECURITY_GROUP_NAME:-bridgeability-rds-sg}"
subnet_group_name="${RDS_SUBNET_GROUP_NAME:-bridgeability-db-subnets}"

echo "provision: region=$region vpc=$VPC_ID"
echo

# ---------------------------------------------------------------------------------------------
# 1. DynamoDB -- both tables, idempotent, already scripted.
# ---------------------------------------------------------------------------------------------
echo "== DynamoDB =="
AWS_REGION="$region" bash "$repo_root/db/dynamodb/create-tables.sh"
echo

# ---------------------------------------------------------------------------------------------
# 2. S3 -- bucket with Block Public Access, versioning and encryption all on, per CLAUDE.md.
#    No public bucket policy is ever applied: every read and write goes through a
#    backend-generated presigned URL (see src/data/s3/client.js).
# ---------------------------------------------------------------------------------------------
echo "== S3 =="
if aws s3api head-bucket --bucket "$S3_BUCKET" --region "$region" 2>/dev/null; then
  echo "s3: $S3_BUCKET already exists, skipping creation"
else
  echo "s3: creating $S3_BUCKET"
  if [[ "$region" == "us-east-1" ]]; then
    # us-east-1 is the one region create-bucket rejects a LocationConstraint for.
    aws s3api create-bucket --bucket "$S3_BUCKET" --region "$region" >/dev/null
  else
    aws s3api create-bucket --bucket "$S3_BUCKET" --region "$region" \
      --create-bucket-configuration "LocationConstraint=$region" >/dev/null
  fi
fi

aws s3api put-public-access-block --bucket "$S3_BUCKET" --region "$region" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
echo "s3: Block Public Access on"

aws s3api put-bucket-versioning --bucket "$S3_BUCKET" --region "$region" \
  --versioning-configuration "Status=Enabled"
echo "s3: versioning on"

aws s3api put-bucket-encryption --bucket "$S3_BUCKET" --region "$region" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
echo "s3: default encryption on (SSE-S3/AES256)"

echo "s3: CORS is applied separately, once the Elastic Beanstalk URL is known -- see"
echo "    scripts/apply-s3-cors.sh (APP_ORIGIN=<your-eb-url> bash scripts/apply-s3-cors.sh)"
echo

# ---------------------------------------------------------------------------------------------
# 3. RDS -- a security group that admits 3306 only from the app tier, a subnet group, and the
#    MySQL 8.0.43 instance itself, PubliclyAccessible=false throughout (CLAUDE.md, non-negotiable).
# ---------------------------------------------------------------------------------------------
echo "== RDS =="

rds_sg_id="$(aws ec2 describe-security-groups --region "$region" \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=$rds_sg_name" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"

if [[ -z "$rds_sg_id" || "$rds_sg_id" == "None" ]]; then
  echo "rds: creating security group $rds_sg_name"
  rds_sg_id="$(aws ec2 create-security-group --region "$region" \
    --group-name "$rds_sg_name" \
    --description "Admits 3306 from the BridgeAbility app tier only" \
    --vpc-id "$VPC_ID" --query 'GroupId' --output text)"
  # Ingress by security-group reference, not by CIDR: only instances actually wearing the app
  # security group can reach 3306, regardless of what IP they land on.
  aws ec2 authorize-security-group-ingress --region "$region" \
    --group-id "$rds_sg_id" --protocol tcp --port 3306 \
    --source-group "$APP_SECURITY_GROUP_ID" >/dev/null
  echo "rds: $rds_sg_id created, 3306 admitted from $APP_SECURITY_GROUP_ID only"
else
  echo "rds: security group $rds_sg_name already exists ($rds_sg_id), skipping"
fi

if aws rds describe-db-subnet-groups --region "$region" \
    --db-subnet-group-name "$subnet_group_name" >/dev/null 2>&1; then
  echo "rds: subnet group $subnet_group_name already exists, skipping"
else
  echo "rds: creating subnet group $subnet_group_name"
  # AWS CLI wants subnet IDs space-separated for this call; SUBNET_IDS is comma-separated to
  # match the --vpc.ec2subnets flag documented in README.md#deploying.
  # shellcheck disable=SC2206
  subnet_id_array=(${SUBNET_IDS//,/ })
  aws rds create-db-subnet-group --region "$region" \
    --db-subnet-group-name "$subnet_group_name" \
    --db-subnet-group-description "BridgeAbility RDS subnets" \
    --subnet-ids "${subnet_id_array[@]}" >/dev/null
fi

if aws rds describe-db-instances --region "$region" \
    --db-instance-identifier "$db_instance_id" >/dev/null 2>&1; then
  echo "rds: instance $db_instance_id already exists, skipping creation"
else
  echo "rds: creating $db_instance_id (MySQL $db_engine_version, $db_instance_class) -- this takes 10-15 minutes"
  aws rds create-db-instance --region "$region" \
    --db-instance-identifier "$db_instance_id" \
    --db-name "$db_name" \
    --engine mysql \
    --engine-version "$db_engine_version" \
    --db-instance-class "$db_instance_class" \
    --allocated-storage "$db_allocated_storage" \
    --master-username "$db_user" \
    --master-user-password "$DB_PASSWORD" \
    --vpc-security-group-ids "$rds_sg_id" \
    --db-subnet-group-name "$subnet_group_name" \
    --no-publicly-accessible \
    --no-multi-az \
    --backup-retention-period 0 >/dev/null
fi

echo "rds: waiting for $db_instance_id to become available (this is the slow part)..."
aws rds wait db-instance-available --region "$region" --db-instance-identifier "$db_instance_id"

db_host="$(aws rds describe-db-instances --region "$region" \
  --db-instance-identifier "$db_instance_id" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
echo "rds: available at $db_host"
echo

# ---------------------------------------------------------------------------------------------
echo "== Done =="
echo "Set these as Elastic Beanstalk environment properties (eb setenv, or the console) --"
echo "never write them into a tracked file:"
echo
echo "  DB_HOST=$db_host"
echo "  DB_PORT=3306"
echo "  DB_USER=$db_user"
echo "  DB_NAME=$db_name"
echo "  S3_BUCKET=$S3_BUCKET"
echo "  DDB_TIMELINE_TABLE=BridgeAbility_BookingTimeline"
echo "  DDB_SESSIONS_TABLE=BridgeAbility_Sessions"
echo
echo "DB_PASSWORD is the value you already passed in -- it was not printed above and is not"
echo "stored anywhere by this script."
echo
echo "Next: eb create (see README.md#deploying), then npm run migrate runs from the instance"
echo "on first deploy via .ebextensions/01-migrate.config."
