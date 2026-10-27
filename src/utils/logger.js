'use strict';

const pino = require('pino');

/** Paths that must never reach the logs, wherever they appear. */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.payoutMethod',
  '*.payoutDetailsCiphertext',
  '*.upiId',
  '*.accountNumber',
  '*.ifsc',
  '*.token',
];

function createLogger({ logLevel = 'info' } = {}) {
  return pino({
    level: logLevel,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'affiliate-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

module.exports = { createLogger, REDACT_PATHS };
