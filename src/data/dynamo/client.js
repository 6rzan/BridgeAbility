'use strict';

const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const config = require('../../config');



const baseClient = new DynamoDBClient({ region: config.region });



const documentClient = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: { removeUndefinedValues: true },
});


async function ping() {
  await baseClient.send(new DescribeTableCommand({ TableName: config.dynamo.timelineTable }));
}

module.exports = { baseClient, documentClient, ping };
