'use strict';

const freeze = (values) => Object.freeze([...values]);

module.exports = Object.freeze({
  ROLES: freeze(['affiliate', 'ops', 'finance']),
  USER_STATUSES: freeze(['pending', 'active', 'rejected']),
  PROMOTION_CHANNELS: freeze(['instagram', 'youtube', 'website', 'messaging', 'other']),
  PAYOUT_METHOD_TYPES: freeze(['upi', 'bank']),
  COMMISSION_STATUSES: freeze(['pending', 'approved', 'rejected', 'processing', 'paid']),
  BATCH_STATUSES: freeze(['draft', 'exported', 'paid', 'closed_with_failures', 'cancelled']),
  BATCH_ITEM_STATUSES: freeze(['pending', 'paid', 'failed']),
  CONVERSION_SOURCES: freeze(['webhook', 'demo']),
  OPEN_BATCH_KEY: 'OPEN',
  MAX_ORDER_AMOUNT_PAISE: 100_000_000_00, // ₹10 crore, a sanity ceiling per order
});
