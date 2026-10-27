'use strict';

const crypto = require('node:crypto');

// No 0/O/1/I/L: codes are read aloud and typed from screenshots.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** Uniformly random, unguessable referral code (crypto RNG, no modulo bias). */
function generateReferralCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}

module.exports = { generateReferralCode, REFERRAL_CODE_PATTERN: /^[A-Z2-9]{8}$/ };
