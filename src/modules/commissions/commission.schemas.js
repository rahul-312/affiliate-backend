'use strict';

const { z, objectId, idList, reason, pagination } = require('../../utils/validation');
const { COMMISSION_STATUSES } = require('../../models/constants');

const listQuery = z.strictObject({
  status: z.enum(COMMISSION_STATUSES).optional(),
  affiliateId: objectId.optional(),
  ...pagination,
});

const approveBody = z.strictObject({ ids: idList });

const rejectBody = z.strictObject({ ids: idList, reason });

module.exports = { listQuery, approveBody, rejectBody };
