'use strict';

const jwt = require('jsonwebtoken');
const { unauthorized } = require('../../utils/errors');

const ISSUER = 'affiliate-backend';
const AUDIENCE = 'affiliate-hub';
const ALGORITHM = 'HS256';

function signAccessToken(user, { secret, expiresIn }) {
  return jwt.sign({ role: user.role }, secret, {
    algorithm: ALGORITHM,
    subject: String(user._id),
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn,
  });
}

/** Pins the algorithm, issuer and audience so a forged or foreign token is rejected. */
function verifyAccessToken(token, { secret }) {
  try {
    const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM], issuer: ISSUER, audience: AUDIENCE });
    if (typeof payload.sub !== 'string' || !/^[a-f\d]{24}$/i.test(payload.sub)) throw new Error('bad subject');
    return payload;
  } catch {
    throw unauthorized('Your session is invalid or has expired. Please sign in again.');
  }
}

module.exports = { signAccessToken, verifyAccessToken };
