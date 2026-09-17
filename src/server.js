'use strict';

const app = require('./app');
const config = require('./config');

const server = app.listen(config.port, () => {
  console.log(`[startup] BridgeAbility listening on port ${config.port} (${config.nodeEnv})`);
});

function shutdown(signal) {
  console.log(`[shutdown] received ${signal}, closing server`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
