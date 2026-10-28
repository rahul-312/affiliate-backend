'use strict';

const { rateLimit } = require('express-rate-limit');

const limitExceeded = (message) => ({ error: { code: 'RATE_LIMITED', message } });

/** Brute-force protection on login and sign-up. */
const createAuthLimiter = (max) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: limitExceeded('Too many attempts. Please wait a few minutes and try again.'),
  });

/** General ceiling for every API route. */
const createApiLimiter = (max) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: limitExceeded('Too many requests. Please slow down.'),
  });

/** Per-user ceiling on account status changes (pause/resume): 20 an hour is plenty for a person. */
const createAccountActionLimiter = () =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: limitExceeded('Too many changes to your account status. Please try again later.'),
  });

module.exports = { createAuthLimiter, createApiLimiter, createAccountActionLimiter };
