'use strict';

const { z, orderId, orderAmountPaise, referralCode } = require('../../utils/validation');

const conversionBody = z.strictObject({ orderId, referralCode, orderAmountPaise });

/** The demo form may omit orderId; one is generated so each click is a new sale. */
const simulateSaleBody = z.strictObject({ orderId: orderId.optional(), referralCode, orderAmountPaise });

module.exports = { conversionBody, simulateSaleBody };
