'use strict';

/**
 * Vercel serverless entry point. src/server.js is the entry everywhere else.
 * Each function instance validates config and connects to MongoDB once, then
 * reuses the app and connection for every request it serves.
 */
const { loadConfig } = require('../src/config/env');
const { createLogger } = require('../src/utils/logger');
const { connectDatabase } = require('../src/db/connect');
const { createApp } = require('../src/app');

let appPromise;

function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const config = loadConfig(process.env);
      const logger = createLogger(config);
      await connectDatabase(config.mongodbUri, logger);
      return createApp(config, { logger });
    })().catch((err) => {
      // Let the next request retry instead of caching the failure.
      appPromise = undefined;
      throw err;
    });
  }
  return appPromise;
}

module.exports = async (req, res) => {
  let app;
  try {
    app = await getApp();
  } catch (err) {
    console.error('[affiliate-backend] Failed to start:', err.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is starting up. Please try again.' } }));
    return;
  }
  app(req, res);
};
