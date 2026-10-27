'use strict';

const { z, email, password } = require('../../utils/validation');
const { PROMOTION_CHANNELS } = require('../../models/constants');

/**
 * Strict whitelist: only these fields are accepted. Anything else, including
 * attempts to set role, status or referralCode, is rejected with 400.
 */
const signupBody = z.strictObject({
  name: z.string().trim().min(2, 'must be at least 2 characters').max(100),
  email,
  password,
  promotionChannel: z.enum(PROMOTION_CHANNELS),
  promotionUrl: z
    .string()
    .trim()
    .max(500)
    .pipe(z.url({ protocol: /^https?$/, error: 'must be a full http(s) link, e.g. https://instagram.com/yourname' }))
    .optional(),
});

const loginBody = z.strictObject({
  email,
  password: z.string().min(1, 'is required').max(200),
});

module.exports = { signupBody, loginBody };
