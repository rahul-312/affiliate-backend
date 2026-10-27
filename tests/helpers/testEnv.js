'use strict';

/** A valid environment for tests. Individual tests override single values to probe validation. */
const TEST_ENV = Object.freeze({
  NODE_ENV: 'test',
  PORT: '4000',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/placeholder-overridden-per-test',
  JWT_SECRET: 'test-jwt-secret-0123456789abcdefghijklmnopqrstuvwxyz',
  JWT_EXPIRES_IN: '1h',
  CONVERSION_API_KEY: 'test-conversion-key-0123456789abcdef',
  PAYOUT_DETAILS_KEY: 'a'.repeat(64),
  CORS_ORIGINS: 'http://localhost:3000',
  DEMO_MODE: 'true',
  LOG_LEVEL: 'silent',
  AUTH_RATE_LIMIT_MAX: '10000',
  API_RATE_LIMIT_MAX: '10000',
});

module.exports = { TEST_ENV };
