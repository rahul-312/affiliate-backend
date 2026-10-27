'use strict';

const { User, Commission, PayoutBatch } = require('../../models');
const { OPEN_BATCH_KEY } = require('../../models/constants');
const { formatBatchNo } = require('../serializers');
const { computePayoutEligibility } = require('../payouts/payout.rules');

const startOfCurrentMonthUtc = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

async function getOverviewStats() {
  const [newApplications, commissionTotals, paidThisMonth, openBatch, eligibility] = await Promise.all([
    User.countDocuments({ role: 'affiliate', status: 'pending' }),
    Commission.aggregate([{ $group: { _id: '$status', amountPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } }]),
    PayoutBatch.aggregate([
      { $match: { status: { $in: ['paid', 'closed_with_failures'] }, paidAt: { $gte: startOfCurrentMonthUtc() } } },
      { $group: { _id: null, amountPaise: { $sum: '$paidPaise' } } },
    ]),
    PayoutBatch.findOne({ openBatchKey: OPEN_BATCH_KEY }, { batchNo: 1, status: 1, originalTotalPaise: 1 }).lean(),
    computePayoutEligibility(),
  ]);

  const byStatus = Object.fromEntries(commissionTotals.map((t) => [t._id, t]));
  const totals = (status) => ({ count: byStatus[status]?.count ?? 0, amountPaise: byStatus[status]?.amountPaise ?? 0 });

  return {
    newApplications,
    pendingCommissions: totals('pending'),
    approvedUnpaid: {
      approvedPaise: totals('approved').amountPaise,
      processingPaise: totals('processing').amountPaise,
      totalPaise: totals('approved').amountPaise + totals('processing').amountPaise,
    },
    paidThisMonthPaise: paidThisMonth[0]?.amountPaise ?? 0,
    readyForPayoutPaise: eligibility.eligible.reduce((sum, e) => sum + e.amountPaise, 0),
    missingPayoutDetailsCount: eligibility.missingDetails.length,
    openBatch: openBatch
      ? { id: String(openBatch._id), batchNo: formatBatchNo(openBatch.batchNo), status: openBatch.status, originalTotalPaise: openBatch.originalTotalPaise }
      : null,
  };
}

module.exports = { getOverviewStats };
