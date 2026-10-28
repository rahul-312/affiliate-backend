'use strict';

const { z } = require('zod');
const { MAX_ORDER_AMOUNT_PAISE, MIN_AFFILIATE_RATE_BPS, MAX_AFFILIATE_RATE_BPS } = require('../models/constants');

/** Shared zod building blocks so every route validates the same things the same way. */

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'must be a valid id');

const email = z.string().trim().toLowerCase().max(254).pipe(z.email('must be a valid email'));

// bcrypt only uses the first 72 bytes; cap length so nothing is silently ignored.
const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'must be at most 72 bytes');

const reason = z.string().trim().min(3, 'must be at least 3 characters').max(500);

const orderAmountPaise = z
  .number({ error: 'must be a whole number of paise' })
  .int('must be a whole number of paise')
  .positive('must be greater than zero')
  .max(MAX_ORDER_AMOUNT_PAISE);

// Basis points: 1250 = 12.5%.
const rateBps = z
  .number({ error: 'must be a whole number of basis points' })
  .int('must be a whole number of basis points')
  .min(MIN_AFFILIATE_RATE_BPS, `must be at least ${MIN_AFFILIATE_RATE_BPS / 100}%`)
  .max(MAX_AFFILIATE_RATE_BPS, `must be at most ${MAX_AFFILIATE_RATE_BPS / 100}%`);

const orderId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._:\-/#]+$/, 'may contain letters, digits and . _ : - / # only');

const referralCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,16}$/, 'must be a valid referral code');

const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
};

const idList = z
  .array(objectId)
  .min(1, 'select at least one item')
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, 'ids must be unique');

module.exports = { z, objectId, email, password, reason, orderAmountPaise, rateBps, orderId, referralCode, pagination, idList };
