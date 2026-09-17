#!/usr/bin/env bash

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

echo "== DynamoDB =="
AWS_REGION="$region" bash "$repo_root/db/dynamodb/create-tables.sh"
echo

echo "== S3 =="
if aws s3api head-bucket --bucket "$S3_BUCKET" --region "$region" 2>/dev/null; then
  echo "s3: $S3_BUCKET already exists, skipping creation"
else
  echo "s3: creating $S3_BUCKET"
  if [[ "$region" == "us-east-1" ]]; then

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
