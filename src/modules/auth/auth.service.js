'use strict';

const { User } = require('../../models');
const { conflict, unauthorized, isDuplicateKeyError } = require('../../utils/errors');
const { generateReferralCode } = require('../../utils/referralCode');
const { hashPassword, verifyPassword } = require('./password');
const { signAccessToken } = require('./token');

const MAX_REFERRAL_CODE_ATTEMPTS = 5;

/**
 * Creates an affiliate application. Role, status and referral code are always
 * assigned here, never taken from the request. The referral code exists from
 * day one but only works once ops approves the account.
 */
async function signUpAffiliate({ name, email, password, promotionChannel, promotionUrl }) {
  const passwordHash = await hashPassword(password);

  for (let attempt = 1; attempt <= MAX_REFERRAL_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await User.create({
        name,
        email,
        passwordHash,
        promotionChannel,
        promotionUrl,
        role: 'affiliate',
        status: 'pending',
        referralCode: generateReferralCode(),
      });
    } catch (err) {
      if (isDuplicateKeyError(err, 'email')) {
        throw conflict('An account with this email already exists', undefined, 'EMAIL_TAKEN');
      }
      // Astronomically unlikely, but a colliding referral code just gets a fresh one.
      if (!isDuplicateKeyError(err, 'referralCode') || attempt === MAX_REFERRAL_CODE_ATTEMPTS) throw err;
    }
  }
  throw new Error('unreachable');
}

/** Same error and timing for "no such user" and "wrong password". */
async function authenticateCredentials({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const valid = await verifyPassword(password, user?.passwordHash);
  if (!user || !valid) throw unauthorized('Invalid email or password');
  return user;
}

const issueSession = (user, jwtConfig) => ({ token: signAccessToken(user, jwtConfig) });

module.exports = { signUpAffiliate, authenticateCredentials, issueSession };
