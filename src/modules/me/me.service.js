'use strict';

const { Commission, PayoutBatch, User } = require('../../models');
const { forbidden } = require('../../utils/errors');
const { maskPayoutDetails } = require('../../utils/payoutMethod');
const { runInTransaction } = require('../../utils/transaction');
const { recordAudit } = require('../audit/audit.service');
const { getProgramSettings } = require('../program/program.service');
const { classifyPayoutReadiness, hasPayoutDetails, isPayoutOnHold } = require('../payouts/payout.rules');
const { formatBatchNo } = require('../serializers');

/**
 * Balance terms shown in the app, all derived from commission records using
 * the same readiness rule as batch creation.
 */
async function getSummary(user) {
  const [settings, totals] = await Promise.all([
    getProgramSettings(),
    Commission.aggregate([
      { $match: { affiliateId: user._id } },
      { $group: { _id: '$status', amountPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    ]),
  ]);
  const byStatus = Object.fromEntries(totals.map((t) => [t._id, t]));
  const amount = (status) => byStatus[status]?.amountPaise ?? 0;

  const approvedPaise = amount('approved');
  const hasDetails = hasPayoutDetails(user);
  const onHold = isPayoutOnHold(user);
  const readiness = classifyPayoutReadiness({
    approvedPaise,
    onHold,
    hasPayoutDetails: hasDetails,
    minPayoutPaise: settings.minPayoutPaise,
  });

  return {
    pendingPaise: amount('pending'),
    approvedPaise,
    processingPaise: amount('processing'),
    paidPaise: amount('paid'),
    rejectedPaise: amount('rejected'),
    availableForNextPayoutPaise: readiness === 'eligible' ? approvedPaise : 0,
    minPayoutPaise: settings.minPayoutPaise,
    hasPayoutDetails: hasDetails,
    payoutsOnHold: approvedPaise > 0 && onHold,
    needsPayoutDetails: approvedPaise > 0 && !hasDetails,
    belowMinimum: approvedPaise > 0 && approvedPaise < settings.minPayoutPaise,
    commissionCount: totals.reduce((n, t) => n + t.count, 0),
  };
}

async function listOwnCommissions(user, { status, page, limit }) {
  const filter = { affiliateId: user._id, ...(status && { status }) };
  const [items, total] = await Promise.all([
    Commission.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Commission.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

/** Only successfully paid items. A failed item never shows here; its commissions are approved again. */
async function listOwnPayouts(user) {
  const batches = await PayoutBatch.find({
    status: { $in: ['paid', 'closed_with_failures'] },
    items: { $elemMatch: { affiliateId: user._id, status: 'paid' } },
  })
    .sort({ paidAt: -1 })
    .lean();

  return batches.map((batch) => {
    const item = batch.items.find((i) => String(i.affiliateId) === String(user._id) && i.status === 'paid');
    return {
      batchId: String(batch._id),
      batchNo: formatBatchNo(batch.batchNo),
      amountPaise: item.amountPaise,
      commissionCount: item.commissionCount,
      paidAt: batch.paidAt,
      paymentReference: batch.paymentReference,
    };
  });
}

/**
 * Stores payout details encrypted; only a masked summary is kept in clear.
 * Available once the application is approved: there is nothing to pay before that.
 */
async function updatePayoutMethod(user, details, { cipher }) {
  // Allowed while active or self-paused (earned commissions are still paid then). Not while ops has
  // deactivated the account: payouts are on hold and details shouldn't change mid-review.
  const editable = { role: 'affiliate', $or: [{ status: 'active' }, { status: 'deactivated', deactivatedByRole: 'affiliate' }] };
  if (user.role !== 'affiliate' || !['active', 'deactivated'].includes(user.status)) {
    throw forbidden('You can add payout details once your application is approved');
  }
  if (user.status === 'deactivated' && user.deactivatedByRole !== 'affiliate') {
    throw forbidden('Your account is paused by the affiliate team, so payout details can’t be changed right now. Please contact them.');
  }
  const payoutMethod = { type: details.type, masked: maskPayoutDetails(details), updatedAt: new Date() };

  return runInTransaction(async (session) => {
    const updated = await User.findOneAndUpdate(
      { _id: user._id, ...editable },
      { $set: { payoutMethod, payoutDetailsCiphertext: cipher.encrypt(details) } },
      { new: true, session },
    );
    if (!updated) throw forbidden('You can add payout details once your application is approved');
    await recordAudit(
      [{ actor: { id: user._id, role: user.role }, entity: 'User', entityId: user._id, action: 'update_payout_method', note: details.type }],
      session,
    );
    return updated;
  });
}

module.exports = { getSummary, listOwnCommissions, listOwnPayouts, updatePayoutMethod };
