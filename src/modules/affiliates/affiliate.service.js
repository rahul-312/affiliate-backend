'use strict';

const { User } = require('../../models');
const { runInTransaction } = require('../../utils/transaction');
const { notFound, conflict, forbidden } = require('../../utils/errors');
const { recordAudit } = require('../audit/audit.service');
const { getProgramSettings } = require('../program/program.service');

const formatRate = (bps) => `${bps / 100}%`;

/** Statuses an approved affiliate can be in. */
const APPROVED_STATUSES = Object.freeze(['active', 'deactivated']);

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
 * Changes an approved affiliate's rate (active or deactivated). Applies to
 * future sales only: every existing commission keeps the rate it snapshotted
 * when it was created. Setting the current rate again changes nothing.
 */
async function setCommissionRate(affiliateId, rateBps, actor) {
  return runInTransaction(async (session) => {
    const current = await User.findOne({ _id: affiliateId, role: 'affiliate' }).session(session);
    if (!current) throw notFound('Affiliate not found');
    if (!APPROVED_STATUSES.includes(current.status)) {
      throw conflict(`Only approved affiliates have a rate to change (this one is ${current.status})`, { status: current.status }, 'INVALID_TRANSITION');
    }
    const previous = current.commissionRateBps ?? (await getProgramSettings(session)).rateBps;
    if (previous === rateBps && current.commissionRateBps !== undefined) return current;

    const updated = await User.findOneAndUpdate(
      { _id: affiliateId, role: 'affiliate', status: current.status },
      { $set: { commissionRateBps: rateBps } },
      { new: true, session },
    );
    if (!updated) throw conflict('This affiliate changed while saving. Please try again.', undefined, 'INVALID_TRANSITION');

    await recordAudit(
      [
        {
          actor,
          entity: 'User',
          entityId: updated._id,
          action: 'rate_change',
          from: String(previous),
          to: String(rateBps),
          note: `Commission rate ${formatRate(previous)} → ${formatRate(rateBps)}, applies to new sales`,
        },
      ],
      session,
    );
    return updated;
  });
}

/**
 * Pauses or restores an approved affiliate. While deactivated the referral
 * link is off and new sales are refused. Commissions already earned stay
 * payable after a self-pause; after an ops deactivation they are held (see
 * payout.rules). Reactivating keeps the affiliate's rate and referral code.
 *
 * - An affiliate can pause themselves (reason optional) and resume only a pause they started.
 * - Ops can deactivate an active affiliate or take over a self-pause (reason required), and
 *   can reactivate anyone, optionally with a note.
 */
async function setActive(affiliateId, { active, reason, actor }) {
  const bySelf = actor.role === 'affiliate';
  return runInTransaction(async (session) => {
    let filter;
    let update;
    if (active) {
      filter = { _id: affiliateId, role: 'affiliate', status: 'deactivated', ...(bySelf && { deactivatedByRole: 'affiliate' }) };
      update = { $set: { status: 'active' }, $unset: { deactivationReason: 1, deactivatedBy: 1, deactivatedByRole: 1, deactivatedAt: 1 } };
    } else {
      // Ops may also convert a self-pause into an ops deactivation, so the affiliate can no longer resume it.
      const pausable = bySelf ? [{ status: 'active' }] : [{ status: 'active' }, { status: 'deactivated', deactivatedByRole: 'affiliate' }];
      filter = { _id: affiliateId, role: 'affiliate', $or: pausable };
      const set = { status: 'deactivated', deactivatedBy: actor.id, deactivatedByRole: bySelf ? 'affiliate' : 'ops', deactivatedAt: new Date() };
      // Taking over a self-pause replaces the affiliate's own reason; a pause without one clears any stale reason.
      update = reason ? { $set: { ...set, deactivationReason: reason } } : { $set: set, $unset: { deactivationReason: 1 } };
    }

    const before = await User.findOneAndUpdate(filter, update, { new: false, session });
    if (!before) {
      const current = await User.findOne({ _id: affiliateId, role: 'affiliate' }, { status: 1, deactivatedByRole: 1 })
        .session(session)
        .lean();
      if (!current) throw notFound('Affiliate not found');
      if (active && bySelf && current.status === 'deactivated') {
        throw forbidden('Your account was paused by the affiliate team. Please contact them to reactivate it.');
      }
      const verb = active ? (bySelf ? 'resumed' : 'reactivated') : bySelf ? 'paused' : 'deactivated';
      throw conflict(`This account can't be ${verb} (it is ${current.status})`, { status: current.status }, 'INVALID_TRANSITION');
    }

    const action = active ? (bySelf ? 'resume' : 'reactivate') : bySelf ? 'pause' : 'deactivate';
    await recordAudit(
      [{ actor, entity: 'User', entityId: before._id, action, from: before.status, to: active ? 'active' : 'deactivated', note: reason }],
      session,
    );
    return User.findById(before._id).session(session);
  });
}

const deactivateAffiliate = (id, reason, actor) => setActive(id, { active: false, reason, actor });
const reactivateAffiliate = (id, note, actor) => setActive(id, { active: true, reason: note, actor });

module.exports = { listAffiliates, approveAffiliate, rejectAffiliate, setCommissionRate, deactivateAffiliate, reactivateAffiliate };
