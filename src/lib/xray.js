'use strict';

const AWSXRay = require('aws-xray-sdk-core');
const captureMySQL = require('aws-xray-sdk-mysql');

AWSXRay.setContextMissingStrategy('LOG_ERROR');

captureMySQL(require('mysql2'));

module.exports = AWSXRay;
