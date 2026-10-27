'use strict';

const { User } = require('../../models');
const { runInTransaction } = require('../../utils/transaction');
const { notFound, conflict } = require('../../utils/errors');
const { recordAudit } = require('../audit/audit.service');

async function listAffiliates({ status, page, limit }) {
  const filter = { role: 'affiliate', ...(status && { status }) };
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

/** Status-guarded decision on a pending application, recorded in the audit log. */
async function decideApplication(affiliateId, { to, actor, reason }) {
  return runInTransaction(async (session) => {
    const now = new Date();
    const set =
      to === 'active'
        ? { status: 'active', approvedBy: actor.id, approvedAt: now }
        : { status: 'rejected', rejectionReason: reason, rejectedBy: actor.id, rejectedAt: now };

    const updated = await User.findOneAndUpdate(
      { _id: affiliateId, role: 'affiliate', status: 'pending' },
      { $set: set },
      { new: true, session },
    );
    if (!updated) {
      const current = await User.findOne({ _id: affiliateId, role: 'affiliate' }, { status: 1 }).session(session).lean();
      if (!current) throw notFound('Affiliate not found');
      throw conflict(`This application is already ${current.status}`, { status: current.status }, 'INVALID_TRANSITION');
    }

    await recordAudit(
      [{ actor, entity: 'User', entityId: updated._id, action: to === 'active' ? 'approve' : 'reject', from: 'pending', to, note: reason }],
      session,
    );
    return updated;
  });
}

const approveAffiliate = (id, actor) => decideApplication(id, { to: 'active', actor });
const rejectAffiliate = (id, reason, actor) => decideApplication(id, { to: 'rejected', actor, reason });

module.exports = { listAffiliates, approveAffiliate, rejectAffiliate };
