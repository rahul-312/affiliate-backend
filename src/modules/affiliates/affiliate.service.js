'use strict';

const { User } = require('../../models');
const { runInTransaction } = require('../../utils/transaction');
const { notFound, conflict, forbidden } = require('../../utils/errors');
const { recordAudit } = require('../audit/audit.service');
const { getProgramSettings } = require('../program/program.service');

const formatRate = (bps) => `${bps / 100}%`;

async function listAffiliates({ status, page, limit }) {
  const filter = { role: 'affiliate', ...(status && { status }) };
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

/** Status-guarded decision on a pending application, recorded in the audit log. */
async function decideApplication(affiliateId, { to, actor, reason, rateBps }) {
  return runInTransaction(async (session) => {
    const now = new Date();
    let set;
    let note = reason;
    if (to === 'active') {
      // The rate is fixed at approval, so a later change to the program rate never moves an approved affiliate.
      const commissionRateBps = rateBps ?? (await getProgramSettings(session)).rateBps;
      set = { status: 'active', approvedBy: actor.id, approvedAt: now, commissionRateBps };
      note = `Commission rate ${formatRate(commissionRateBps)}`;
    } else {
      set = { status: 'rejected', rejectionReason: reason, rejectedBy: actor.id, rejectedAt: now };
    }

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
      [{ actor, entity: 'User', entityId: updated._id, action: to === 'active' ? 'approve' : 'reject', from: 'pending', to, note }],
      session,
    );
    return updated;
  });
}

const approveAffiliate = (id, rateBps, actor) => decideApplication(id, { to: 'active', actor, rateBps });
const rejectAffiliate = (id, reason, actor) => decideApplication(id, { to: 'rejected', actor, reason });

/**
 * Changes an active affiliate's rate. Applies to future sales only: every
 * existing commission keeps the rate it snapshotted when it was created.
 */
async function setCommissionRate(affiliateId, rateBps, actor) {
  return runInTransaction(async (session) => {
    const before = await User.findOneAndUpdate(
      { _id: affiliateId, role: 'affiliate', status: 'active' },
      { $set: { commissionRateBps: rateBps } },
      { new: false, session },
    );
    if (!before) {
      const current = await User.findOne({ _id: affiliateId, role: 'affiliate' }, { status: 1 }).session(session).lean();
      if (!current) throw notFound('Affiliate not found');
      throw conflict(`Only active affiliates have a rate to change (this one is ${current.status})`, { status: current.status }, 'INVALID_TRANSITION');
    }

    const previous = before.commissionRateBps ?? (await getProgramSettings(session)).rateBps;
    await recordAudit(
      [
        {
          actor,
          entity: 'User',
          entityId: before._id,
          action: 'rate_change',
          from: String(previous),
          to: String(rateBps),
          note: `Commission rate ${formatRate(previous)} → ${formatRate(rateBps)}, applies to new sales`,
        },
      ],
      session,
    );
    return User.findById(before._id).session(session);
  });
}

/**
 * Pauses or restores an approved affiliate. While deactivated the referral
 * link is off and new sales are refused; commissions already earned stay
 * payable. Reactivating keeps the affiliate's rate and referral code.
 *
 * Ops can pause anyone (reason required) and restore anyone. An affiliate can
 * pause themselves (reason optional) and resume only a pause they started.
 */
async function setActive(affiliateId, { active, reason, actor }) {
  const from = active ? 'deactivated' : 'active';
  const to = active ? 'active' : 'deactivated';
  const bySelf = actor.role === 'affiliate';
  return runInTransaction(async (session) => {
    const filter = { _id: affiliateId, role: 'affiliate', status: from, ...(active && bySelf && { deactivatedByRole: 'affiliate' }) };
    const update = active
      ? { $set: { status: to }, $unset: { deactivationReason: 1, deactivatedBy: 1, deactivatedByRole: 1, deactivatedAt: 1 } }
      : {
          $set: {
            status: to,
            deactivationReason: reason,
            deactivatedBy: actor.id,
            deactivatedByRole: bySelf ? 'affiliate' : 'ops',
            deactivatedAt: new Date(),
          },
        };
    const updated = await User.findOneAndUpdate(filter, update, { new: true, session });
    if (!updated) {
      const current = await User.findOne({ _id: affiliateId, role: 'affiliate' }, { status: 1, deactivatedByRole: 1 })
        .session(session)
        .lean();
      if (!current) throw notFound('Affiliate not found');
      if (active && bySelf && current.status === 'deactivated') {
        throw forbidden('Your account was paused by the affiliate team. Please contact them to reactivate it.');
      }
      const verb = active ? (bySelf ? 'resumed' : 'reactivated') : bySelf ? 'paused' : 'deactivated';
      throw conflict(`Only ${from} accounts can be ${verb} (this one is ${current.status})`, { status: current.status }, 'INVALID_TRANSITION');
    }

    const action = active ? (bySelf ? 'resume' : 'reactivate') : bySelf ? 'pause' : 'deactivate';
    await recordAudit([{ actor, entity: 'User', entityId: updated._id, action, from, to, note: reason }], session);
    return updated;
  });
}

const deactivateAffiliate = (id, reason, actor) => setActive(id, { active: false, reason, actor });
const reactivateAffiliate = (id, actor) => setActive(id, { active: true, actor });

module.exports = { listAffiliates, approveAffiliate, rejectAffiliate, setCommissionRate, deactivateAffiliate, reactivateAffiliate };
