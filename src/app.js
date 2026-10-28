'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const { Router } = require('express');

const { isDatabaseReady } = require('./db/connect');
const { authenticate } = require('./middleware/auth');
const { createErrorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { createAuthLimiter, createApiLimiter } = require('./middleware/rateLimit');
const { createFieldCipher } = require('./utils/fieldEncryption');
const { createLogger } = require('./utils/logger');
const { createProgramRouter } = require('./modules/program/program.routes');
const { createAuthRouter } = require('./modules/auth/auth.routes');
const { createMeRouter } = require('./modules/me/me.routes');
const { createConversionRouter } = require('./modules/conversions/conversion.routes');
const { createAdminRouter } = require('./modules/admin.routes');

function createCorsOptions(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  return {
    // Requests without an Origin header (the mobile app, server-to-server) are not subject to CORS.
    origin: (origin, callback) => callback(null, !origin || allowed.has(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  };
}

function createApiRouter(ctx) {
  const router = Router();
  const { config } = ctx;
  const requireUser = authenticate(config);

  router.get('/health', (_req, res) => {
    const dbUp = isDatabaseReady();
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down' });
  });
  router.use('/program', createProgramRouter(ctx));
  router.use('/auth', createAuthLimiter(config.rateLimit.authMax), createAuthRouter(ctx));
  router.use('/conversions', createConversionRouter(ctx));
  router.use('/me', requireUser, createMeRouter(ctx));
  router.use('/admin', requireUser, createAdminRouter(ctx));
  return router;
}

/**
 * Builds the Express app. It has no side effects (no DB connection, no
 * listening socket), so tests can create as many instances as they need.
 *
 * @param {ReturnType<import('./config/env').loadConfig>} config
 * @param {{ logger?: import('pino').Logger }} [options]
 */
function createApp(config, { logger = createLogger(config) } = {}) {
  const ctx = Object.freeze({ config, logger, cipher: createFieldCipher(config.payoutDetailsKey) });
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');

  app.use(helmet());
  app.use(cors(createCorsOptions(config.corsOrigins)));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(express.json({ limit: '50kb', strict: true }));
  app.use('/api', createApiLimiter(config.rateLimit.apiMax), createApiRouter(ctx));
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}

module.exports = { createApp };
