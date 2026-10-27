'use strict';

const { z, objectId, reason, pagination } = require('../../utils/validation');
const { BATCH_STATUSES } = require('../../models/constants');

const idParams = z.strictObject({ id: objectId });

const listQuery = z.strictObject({ status: z.enum(BATCH_STATUSES).optional(), ...pagination });

const paymentReference = z
  .string({ error: (issue) => (issue.input === undefined ? 'is required' : 'must be text') })
  .trim()
  .min(4, 'must be at least 4 characters')
  .max(64)
  .regex(/^[A-Za-z0-9\-_/]+$/, 'may contain letters, digits and - _ / only');

const confirmBody = z.strictObject({
  paymentReference,
  failedItems: z
    .array(z.strictObject({ affiliateId: objectId, reason }))
    .max(1000)
    .default([]),
});

const cancelBody = z.strictObject({ reason: reason.optional() });

module.exports = { idParams, listQuery, confirmBody, cancelBody };
