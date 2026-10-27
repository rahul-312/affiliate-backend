'use strict';

const bcrypt = require('bcryptjs');

const BCRYPT_COST = 12;

// Compared against when the email is unknown, so login takes the same time
// whether or not the account exists (prevents account enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', BCRYPT_COST);

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_COST);

const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash ?? DUMMY_HASH);

module.exports = { hashPassword, verifyPassword };
