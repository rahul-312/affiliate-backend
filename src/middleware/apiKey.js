'use strict';

const crypto = require('node:crypto');
const { unauthorized } = require('../utils/errors');

/**
 * Constant-time API key check. Both values are hashed first so the
 * comparison takes the same time whatever the length of the supplied key.
 */
function safeEqual(a, b) {
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function requireApiKey(expectedKey) {
  return (req, _res, next) => {
    const supplied = req.get('x-api-key');
    if (!supplied || !safeEqual(supplied, expectedKey)) throw unauthorized('Invalid or missing API key');
    next();
  };
}

module.exports = { requireApiKey };
