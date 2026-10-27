'use strict';

/** Prints fresh random values for the secrets in .env. Paste them in; never commit them. */
const crypto = require('node:crypto');

console.log(`JWT_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
console.log(`CONVERSION_API_KEY=${crypto.randomBytes(32).toString('base64url')}`);
console.log(`PAYOUT_DETAILS_KEY=${crypto.randomBytes(32).toString('hex')}`);
