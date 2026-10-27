'use strict';

const { z, pagination } = require('../../utils/validation');
const { COMMISSION_STATUSES } = require('../../models/constants');

const upiMethod = z.strictObject({
  type: z.literal('upi'),
  upiId: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,63}$/, 'must be a valid UPI ID, e.g. name@okhdfc'),
});

const bankMethod = z.strictObject({
  type: z.literal('bank'),
  accountName: z
    .string()
    .trim()
    .min(2, 'must be at least 2 characters')
    .max(100)
    .regex(/^[A-Za-z][A-Za-z .'-]*$/, "may contain letters, spaces and . ' - only"),
  accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'must be 9 to 18 digits'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'must be a valid IFSC, e.g. HDFC0001234'),
});

const payoutMethodBody = z.discriminatedUnion('type', [upiMethod, bankMethod]);

const commissionsQuery = z.strictObject({ status: z.enum(COMMISSION_STATUSES).optional(), ...pagination });

module.exports = { payoutMethodBody, commissionsQuery };
