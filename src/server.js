'use strict';

require('dotenv').config();

const { loadConfig, ConfigError } = require('./config/env');
const { createLogger } = require('./utils/logger');
const { connectDatabase, disconnectDatabase } = require('./db/connect');
const { createApp } = require('./app');

const SHUTDOWN_TIMEOUT_MS = 10_000;

function loadConfigOrExit() {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[affiliate-backend] Refusing to start. ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

async function main() {
  const config = loadConfigOrExit();
  const logger = createLogger(config);

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });

  await connectDatabase(config.mongodbUri, logger);
  const server = createApp(config, { logger }).listen(config.port, () => {
    logger.info({ port: config.port, demoMode: config.demoMode, env: config.nodeEnv }, 'API listening');
  });

  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[affiliate-backend] Failed to start:', err.message);
  process.exit(1);
});
