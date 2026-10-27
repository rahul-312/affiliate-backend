'use strict';

const { Commission } = require('../../models');
const { runInTransaction } = require('../../utils/transaction');
const { notFound, conflict } = require('../../utils/errors');
const { recordAudit } = require('../audit/audit.service');
const { assertTransition, historyEntry } = require('./commissionStateMachine');

const AFFILIATE_FIELDS = 'name email referralCode';

async function listCommissions({ status, affiliateId, page, limit }) {
  const filter = {
    ...(status && { status }),
    ...(affiliateId && { affiliateId }),
  };
  const [items, total] = await Promise.all([
    Commission.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('affiliateId', AFFILIATE_FIELDS)
      .lean(),
    Commission.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

/**
 * Moves every listed commission from `from` to `to`, all or nothing. The
 * update is status-guarded and its modified count must equal the number of
 * ids; if anything changed underneath us (e.g. a concurrent approval), the
 * transaction aborts and nothing is written.
 */
async function transitionMany({ ids, from, to, actor, note, extraSet = {} }) {
  assertTransition(from, to);

  return runInTransaction(async (session) => {
    const found = await Commission.find({ _id: { $in: ids } }, { status: 1 }).session(session).lean();
    if (found.length !== ids.length) {
      const known = new Set(found.map((c) => String(c._id)));
      throw notFound(`Commission not found: ${ids.filter((id) => !known.has(id)).join(', ')}`);
    }
    const blocked = found.filter((c) => c.status !== from);
    if (blocked.length > 0) {
      throw conflict(
        `Only ${from} commissions can be moved to ${to}. Nothing was changed.`,
        { invalid: blocked.map((c) => ({ id: String(c._id), status: c.status })) },
        'INVALID_TRANSITION',
      );
    }

    const result = await Commission.updateMany(
      { _id: { $in: ids }, status: from },
      { $set: { status: to, ...extraSet }, $push: { history: historyEntry({ from, to, actor, note }) } },
      { session },
    );
    if (result.modifiedCount !== ids.length) {
      throw conflict('Commissions changed while you were working. Refresh and try again.');
    }

    await recordAudit(
      ids.map((id) => ({ actor, entity: 'Commission', entityId: id, action: to === 'approved' ? 'approve' : 'reject', from, to, note })),
      session,
    );
    return { updated: ids.length };
  });
}

const approveCommissions = (ids, actor) => transitionMany({ ids, from: 'pending', to: 'approved', actor });

const rejectCommissions = (ids, reason, actor) =>
  transitionMany({ ids, from: 'pending', to: 'rejected', actor, note: reason, extraSet: { rejectionReason: reason } });

module.exports = { listCommissions, approveCommissions, rejectCommissions };
