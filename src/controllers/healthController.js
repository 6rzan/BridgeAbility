'use strict';

const mysqlPool = require('../data/mysql/pool');
const dynamoClient = require('../data/dynamo/client');
const s3Client = require('../data/s3/client');

/** Probe one dependency, converting a throw into a reported failure rather than a 500. */
async function probe(name, ping) {
  const startedAt = Date.now();
  try {
    await ping();
    return { name, status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { name, status: 'error', latencyMs: Date.now() - startedAt, error: error.message };
  }
}

/**
 * GET /health
 *
 * Reports each cloud dependency separately so a deploy problem can be localised to one
 * service instead of showing a single opaque "unhealthy". Returns 503 if any is down, which
 * is what the Beanstalk load balancer needs in order to pull a bad instance out of service.
 */
async function getHealth(req, res, next) {
  try {
    const dependencies = await Promise.all([
      probe('rds', mysqlPool.ping),
      probe('dynamodb', dynamoClient.ping),
      probe('s3', s3Client.ping),
    ]);

    const healthy = dependencies.every((dependency) => dependency.status === 'ok');

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      dependencies,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getHealth };
