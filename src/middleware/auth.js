'use strict';

const { User } = require('../models');
const { verifyAccessToken } = require('../modules/auth/token');
const { unauthorized, forbidden } = require('../utils/errors');

/**
 * Verifies the bearer token and loads the user on every request. Role and
 * status come from the database, not the token, so a role change or a
 * rejection takes effect immediately rather than when the token expires.
 */
function authenticate(config) {
  return async (req, _res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    const payload = verifyAccessToken(token, config.jwt);
    const user = await User.findById(payload.sub);
    if (!user) throw unauthorized();

    req.user = user;
    next();
  };
}

/** @param {...('affiliate'|'ops'|'finance')} roles */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

module.exports = { authenticate, requireRole };
