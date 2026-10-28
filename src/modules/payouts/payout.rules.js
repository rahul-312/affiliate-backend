'use strict';

const { Commission, User } = require('../../models');
const { getProgramSettings } = require('../program/program.service');

/**
 * The single rule for "can this affiliate be paid in the next payout run?".
 * Batch creation and the affiliate's /me/summary both use it, so the app's
 * "available for next payout" always matches what finance will actually send.
 *
 * An affiliate deactivated by ops is on hold (for example during a fraud
 * review): their commissions stay approved but are not paid until ops
 * reactivates them. A self-paused affiliate is still paid what they earned.
 *
 * @returns {'nothing_approved'|'on_hold'|'missing_details'|'below_minimum'|'eligible'}
 */
function classifyPayoutReadiness({ approvedPaise, onHold = false, hasPayoutDetails, minPayoutPaise }) {
  if (approvedPaise <= 0) return 'nothing_approved';
  if (onHold) return 'on_hold';
  if (!hasPayoutDetails) return 'missing_details';
  if (approvedPaise < minPayoutPaise) return 'below_minimum';
  return 'eligible';
}

const hasPayoutDetails = (user) => Boolean(user?.payoutMethod?.type);

const isPayoutOnHold = (user) => user?.status === 'deactivated' && user?.deactivatedByRole === 'ops';

/**
 * Groups approved, unbatched commissions by affiliate and classifies each one.
 * @param {import('mongoose').ClientSession} [session]
 */
async function computePayoutEligibility(session) {
  const settings = await getProgramSettings(session);
  const groups = await Commission.aggregate([
    { $match: { status: 'approved', payoutBatchId: null } },
    {
      $group: {
        _id: '$affiliateId',
        amountPaise: { $sum: '$amountPaise' },
        commissionCount: { $sum: 1 },
        commissionIds: { $push: '$_id' },
      },
    },
    { $sort: { _id: 1 } },
  ]).session(session ?? null);

  const users = await User.find({ _id: { $in: groups.map((g) => g._id) } }, { name: 1, email: 1, payoutMethod: 1, status: 1, deactivatedByRole: 1 })
    .session(session ?? null)
    .lean();
  const usersById = new Map(users.map((u) => [String(u._id), u]));

  const result = { eligible: [], onHold: [], missingDetails: [], belowMinimum: [], minPayoutPaise: settings.minPayoutPaise };
  for (const group of groups) {
    const user = usersById.get(String(group._id));
    const entry = {
      affiliateId: group._id,
      name: user?.name ?? 'Unknown affiliate',
      email: user?.email ?? null,
      amountPaise: group.amountPaise,
      commissionCount: group.commissionCount,
      commissionIds: group.commissionIds,
    };
    const readiness = classifyPayoutReadiness({
      approvedPaise: group.amountPaise,
      onHold: isPayoutOnHold(user),
      hasPayoutDetails: hasPayoutDetails(user),
      minPayoutPaise: settings.minPayoutPaise,
    });
    if (readiness === 'eligible') result.eligible.push(entry);
    else if (readiness === 'on_hold') result.onHold.push(entry);
    else if (readiness === 'missing_details') result.missingDetails.push(entry);
    else if (readiness === 'below_minimum') result.belowMinimum.push(entry);
  }
  return result;
}

const publicEntry = ({ affiliateId, name, email, amountPaise, commissionCount }) => ({
  affiliateId: String(affiliateId),
  name,
  email,
  amountPaise,
  commissionCount,
});

module.exports = { classifyPayoutReadiness, hasPayoutDetails, isPayoutOnHold, computePayoutEligibility, publicEntry };
