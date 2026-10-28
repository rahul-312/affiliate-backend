'use strict';

const { PayoutBatch, Commission, User } = require('../../models');
const { OPEN_BATCH_KEY } = require('../../models/constants');
const { runInTransaction } = require('../../utils/transaction');
const { sumPaise, paiseToRupeeString } = require('../../utils/money');
const { toCsv } = require('../../utils/csv');
const { badRequest, conflict, notFound, isDuplicateKeyError } = require('../../utils/errors');
const { recordAudit } = require('../audit/audit.service');
const { historyEntry } = require('../commissions/commissionStateMachine');
const { formatBatchNo } = require('../serializers');
const { computePayoutEligibility, publicEntry, isPayoutOnHold } = require('./payout.rules');

const AFFILIATE_FIELDS = 'name email referralCode status deactivatedByRole';

const inconsistent = () =>
  conflict('Batch records are inconsistent with its commissions; nothing was changed', undefined, 'BATCH_INCONSISTENT');

async function loadBatch(id, session) {
  const batch = await PayoutBatch.findById(id).session(session ?? null);
  if (!batch) throw notFound('Payout batch not found');
  return batch;
}

/**
 * Creates a draft batch from every approved, unbatched commission whose
 * affiliate has payout details and meets the minimum payout.
 *
 * The batch row (carrying openBatchKey: 'OPEN') is inserted first, so the
 * partial unique index makes a second open batch impossible, including
 * under concurrent requests. If nothing qualifies, the transaction aborts
 * and no empty batch is left holding the lock.
 */
async function createBatch(actor) {
  try {
    return await runInTransaction(async (session) => {
      const last = await PayoutBatch.findOne({}, { batchNo: 1 }).sort({ batchNo: -1 }).session(session).lean();
      const batch = new PayoutBatch({
        batchNo: (last?.batchNo ?? 0) + 1,
        status: 'draft',
        openBatchKey: OPEN_BATCH_KEY,
        originalTotalPaise: 0,
        items: [],
        createdBy: actor.id,
      });
      await batch.save({ session });

      const { eligible, onHold, missingDetails, belowMinimum } = await computePayoutEligibility(session);
      if (eligible.length === 0) {
        throw conflict(
          'No commissions are ready for payout',
          { skippedMissingDetails: missingDetails.length, skippedBelowMinimum: belowMinimum.length, skippedOnHold: onHold.length },
          'NOTHING_TO_PAY',
        );
      }

      const label = formatBatchNo(batch.batchNo);
      const commissionIds = eligible.flatMap((entry) => entry.commissionIds);
      const update = await Commission.updateMany(
        { _id: { $in: commissionIds }, status: 'approved', payoutBatchId: null },
        {
          $set: { status: 'processing', payoutBatchId: batch._id },
          $push: { history: historyEntry({ from: 'approved', to: 'processing', actor, note: `Added to payout ${label}` }) },
        },
        { session },
      );
      if (update.modifiedCount !== commissionIds.length) {
        throw conflict('Commissions changed while the batch was being created. Please try again.');
      }

      batch.items = eligible.map(({ affiliateId, amountPaise, commissionCount }) => ({
        affiliateId,
        amountPaise,
        commissionCount,
        status: 'pending',
      }));
      batch.originalTotalPaise = sumPaise(eligible.map((entry) => entry.amountPaise));
      await batch.save({ session });

      await recordAudit(
        [
          { actor, entity: 'PayoutBatch', entityId: batch._id, action: 'create', to: 'draft', note: label },
          ...commissionIds.map((id) => ({
            actor, entity: 'Commission', entityId: id, action: 'batch', from: 'approved', to: 'processing', note: label,
          })),
        ],
        session,
      );

      return {
        batch,
        skipped: {
          missingDetails: missingDetails.map(publicEntry),
          belowMinimum: belowMinimum.map(publicEntry),
          onHold: onHold.map(publicEntry),
        },
      };
    });
  } catch (err) {
    if (!isDuplicateKeyError(err, 'openBatchKey') && !isDuplicateKeyError(err, 'batchNo')) throw err;
    const open = await PayoutBatch.findOne({ openBatchKey: OPEN_BATCH_KEY }, { batchNo: 1 }).lean();
    throw conflict(
      open
        ? `Another payout batch is already open (${formatBatchNo(open.batchNo)})`
        : 'Another payout batch was just created. Refresh and try again.',
      open ? { openBatchId: String(open._id), openBatchNo: formatBatchNo(open.batchNo) } : undefined,
      'BATCH_ALREADY_OPEN',
    );
  }
}

async function listBatches({ status, page, limit }) {
  const filter = status ? { status } : {};
  const [items, total] = await Promise.all([
    PayoutBatch.find(filter).sort({ batchNo: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    PayoutBatch.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

async function getBatch(id) {
  const batch = await PayoutBatch.findById(id).populate('items.affiliateId', AFFILIATE_FIELDS).lean();
  if (!batch) throw notFound('Payout batch not found');
  return batch;
}

/**
 * Items in this batch whose affiliate ops has deactivated since the batch was
 * created. Their payouts are on hold, so they must not be paid from this batch.
 */
async function findHeldItems(batch, session) {
  const users = await User.find({ _id: { $in: batch.items.map((i) => i.affiliateId) } }, { name: 1, status: 1, deactivatedByRole: 1 })
    .session(session ?? null)
    .lean();
  const held = new Map(users.filter(isPayoutOnHold).map((u) => [String(u._id), u.name]));
  return batch.items
    .filter((i) => held.has(String(i.affiliateId)))
    .map((i) => ({ affiliateId: String(i.affiliateId), name: held.get(String(i.affiliateId)) }));
}

const heldNames = (held) => held.map((h) => h.name).join(', ');

async function getMissingPayoutDetails() {
  const { missingDetails, minPayoutPaise } = await computePayoutEligibility();
  return { minPayoutPaise, items: missingDetails.map(publicEntry) };
}

const CSV_HEADER = Object.freeze([
  'batch_no', 'affiliate_id', 'beneficiary_name', 'method', 'upi_id', 'account_number', 'ifsc',
  'amount_inr', 'commission_count', 'narration',
]);

const heldInDraft = (held) =>
  conflict(
    `Payouts are on hold for ${heldNames(held)}. Cancel this draft and create a new batch: held affiliates are left out automatically.`,
    { affiliates: held },
    'PAYOUT_ON_HOLD',
  );

/**
 * Builds the bank-upload CSV. This is the only place full payout details are
 * ever decrypted. Downloading is not proof of payment, so it changes no
 * commission status; the first download moves the batch from draft to exported.
 *
 * Bank details are never handed out for an affiliate whose payouts are on hold:
 * a draft containing one can't be exported at all, and re-downloading an
 * exported batch leaves held affiliates out (their transfer may already have
 * been sent from the first download; finance records what happened at confirm).
 */
async function exportBatchCsv(id, actor, { cipher }) {
  const batch = await loadBatch(id);
  if (!['draft', 'exported'].includes(batch.status)) {
    throw conflict(`A ${batch.status} batch cannot be exported`, undefined, 'INVALID_TRANSITION');
  }

  const held = await findHeldItems(batch);
  if (held.length > 0 && batch.status === 'draft') throw heldInDraft(held);
  const heldIds = new Set(held.map((h) => h.affiliateId));
  const exportItems = batch.items.filter((item) => !heldIds.has(String(item.affiliateId)));

  const affiliateIds = exportItems.map((item) => item.affiliateId);
  const users = await User.find({ _id: { $in: affiliateIds } }).select('+payoutDetailsCiphertext').lean();
  const usersById = new Map(users.map((u) => [String(u._id), u]));
  const label = formatBatchNo(batch.batchNo);

  const rows = exportItems.map((item) => {
    const user = usersById.get(String(item.affiliateId));
    if (!user?.payoutDetailsCiphertext) throw inconsistent();
    const details = cipher.decrypt(user.payoutDetailsCiphertext);
    const isUpi = details.type === 'upi';
    return [
      label,
      String(item.affiliateId),
      isUpi ? user.name : details.accountName,
      details.type,
      isUpi ? details.upiId : '',
      isUpi ? '' : details.accountNumber,
      isUpi ? '' : details.ifsc,
      paiseToRupeeString(item.amountPaise),
      item.commissionCount,
      `Affiliate payout ${label}`,
    ];
  });

  await runInTransaction(async (session) => {
    // Status-guarded: a batch cancelled or confirmed meanwhile is not re-opened by a late download.
    const stillOpen =
      batch.status === 'draft'
        ? await PayoutBatch.findOneAndUpdate(
            { _id: batch._id, status: 'draft' },
            { $set: { status: 'exported', exportedAt: new Date(), exportedBy: actor.id } },
            { new: true, session },
          )
        : await PayoutBatch.findOne({ _id: batch._id, status: 'exported' }).session(session);
    if (!stillOpen) throw conflict('This batch changed while exporting. Refresh and try again.', undefined, 'INVALID_TRANSITION');
    // Re-check inside the transaction: a hold placed while the CSV was being built must not slip through.
    const heldNow = await findHeldItems(batch, session);
    if (heldNow.some((h) => !heldIds.has(h.affiliateId))) {
      if (batch.status === 'draft') throw heldInDraft(heldNow);
      throw conflict('A payout was put on hold while exporting. Download the CSV again.', { affiliates: heldNow }, 'PAYOUT_ON_HOLD');
    }
    const note = held.length > 0 ? `${label}, left out on hold: ${heldNames(held)}` : label;
    await recordAudit(
      [{ actor, entity: 'PayoutBatch', entityId: batch._id, action: 'export', from: batch.status, to: 'exported', note }],
      session,
    );
  });

  return { filename: `${label}.csv`, csv: toCsv(CSV_HEADER, rows) };
}

function validateFailedItems(batch, failedItems) {
  const failedReasons = new Map(failedItems.map((f) => [f.affiliateId, f.reason]));
  if (failedReasons.size !== failedItems.length) {
    throw badRequest('An affiliate is listed more than once in failedItems');
  }
  const inBatch = new Set(batch.items.map((item) => String(item.affiliateId)));
  const unknown = failedItems.filter((f) => !inBatch.has(f.affiliateId)).map((f) => f.affiliateId);
  if (unknown.length > 0) {
    throw badRequest('failedItems lists affiliates that are not in this batch', { affiliateIds: unknown });
  }
  return failedReasons;
}

/**
 * Closes an exported batch once finance has sent the money. Each item is
 * resolved exactly once: listed items fail (their commissions go back to
 * approved and are retried next batch), every other item is paid. All
 * counts and amounts are checked against the commissions before commit.
 *
 * An affiliate put on hold after the CSV left the system may or may not have
 * been paid by the bank, so finance must say which: list them in failedItems
 * (not sent; the commissions return to approved and stay held) or in
 * heldPaidAcknowledged (the bank already sent it; recorded as paid and audited).
 * Guessing either way risks paying twice or recording money that never moved.
 */
async function confirmBatch(id, { paymentReference, failedItems, heldPaidAcknowledged }, actor) {
  return runInTransaction(async (session) => {
    const batch = await loadBatch(id, session);
    if (batch.status === 'draft') {
      throw conflict('Download the CSV and send the payments before confirming', undefined, 'BATCH_NOT_EXPORTED');
    }
    if (batch.status !== 'exported') {
      throw conflict(`This batch is already ${batch.status.replace(/_/g, ' ')}`, undefined, 'BATCH_ALREADY_CLOSED');
    }
    const failedReasons = validateFailedItems(batch, failedItems);
    if (batch.items.some((item) => item.status !== 'pending')) throw inconsistent();

    const held = await findHeldItems(batch, session);
    const heldIds = new Set(held.map((h) => h.affiliateId));
    const paidWhileHeld = new Set(heldPaidAcknowledged);
    const notHeld = heldPaidAcknowledged.filter((affiliateId) => !heldIds.has(affiliateId));
    if (notHeld.length > 0) {
      throw badRequest('heldPaidAcknowledged lists affiliates whose payouts are not on hold in this batch', { affiliateIds: notHeld });
    }
    if (heldPaidAcknowledged.some((affiliateId) => failedReasons.has(affiliateId))) {
      throw badRequest('An affiliate cannot be both failed and acknowledged as paid');
    }
    const undecided = held.filter((h) => !failedReasons.has(h.affiliateId) && !paidWhileHeld.has(h.affiliateId));
    if (undecided.length > 0) {
      throw conflict(
        `Payouts are on hold for ${heldNames(undecided)}. Say whether the bank already sent their transfer: mark it as failed if not, or acknowledge it as paid if it went out.`,
        { affiliates: undecided },
        'PAYOUT_ON_HOLD',
      );
    }

    const commissions = await Commission.find(
      { payoutBatchId: batch._id, status: 'processing' },
      { affiliateId: 1, amountPaise: 1 },
    ).session(session).lean();

    const label = formatBatchNo(batch.batchNo);
    const auditEntries = [];
    let paidPaise = 0;
    let failedPaise = 0;

    for (const item of batch.items) {
      const affiliateKey = String(item.affiliateId);
      const own = commissions.filter((c) => String(c.affiliateId) === affiliateKey);
      if (own.length !== item.commissionCount || sumPaise(own.map((c) => c.amountPaise)) !== item.amountPaise) {
        throw inconsistent();
      }

      const reason = failedReasons.get(affiliateKey);
      const failed = reason !== undefined;
      const to = failed ? 'approved' : 'paid';
      const heldPaid = paidWhileHeld.has(affiliateKey);
      const note = failed
        ? `Payout ${label} failed: ${reason}. Retrying in the next payout.`
        : `Paid in ${label} (ref ${paymentReference})${heldPaid ? '; transfer had already gone out when the payout was put on hold' : ''}`;
      const update = await Commission.updateMany(
        { _id: { $in: own.map((c) => c._id) }, payoutBatchId: batch._id, status: 'processing' },
        {
          $set: failed ? { status: 'approved', payoutBatchId: null } : { status: 'paid' },
          $push: { history: historyEntry({ from: 'processing', to, actor, note }) },
        },
        { session },
      );
      if (update.modifiedCount !== item.commissionCount) throw inconsistent();

      item.status = failed ? 'failed' : 'paid';
      if (failed) item.failureReason = reason;
      if (failed) failedPaise += item.amountPaise;
      else paidPaise += item.amountPaise;
      auditEntries.push(
        ...own.map((c) => ({ actor, entity: 'Commission', entityId: c._id, action: failed ? 'payout_failed' : 'pay', from: 'processing', to, note: failed ? reason : label })),
      );
      if (heldPaid) {
        auditEntries.push({
          actor,
          entity: 'User',
          entityId: item.affiliateId,
          action: 'held_payout_acknowledged_paid',
          note: `${label}: finance confirmed the bank had already sent ${paiseToRupeeString(item.amountPaise)} before the hold`,
        });
      }
    }

    if (paidPaise + failedPaise !== batch.originalTotalPaise) throw inconsistent();

    const finalStatus = failedPaise > 0 ? 'closed_with_failures' : 'paid';
    Object.assign(batch, {
      status: finalStatus,
      paidPaise,
      failedPaise,
      paidAt: new Date(),
      paidBy: actor.id,
      paymentReference,
      openBatchKey: undefined,
    });
    await batch.save({ session });

    auditEntries.push({ actor, entity: 'PayoutBatch', entityId: batch._id, action: 'confirm', from: 'exported', to: finalStatus, note: `ref ${paymentReference}` });
    await recordAudit(auditEntries, session);
    return batch;
  });
}

/** Abandoned drafts only: once exported, money may have moved, so it must be closed through confirm. */
async function cancelBatch(id, reason, actor) {
  return runInTransaction(async (session) => {
    const batch = await loadBatch(id, session);
    if (batch.status === 'exported') {
      throw conflict(
        'An exported batch cannot be cancelled because payments may already have been sent. Confirm it and mark unsent items as failed.',
        undefined,
        'INVALID_TRANSITION',
      );
    }
    if (batch.status !== 'draft') throw conflict(`A ${batch.status} batch cannot be cancelled`, undefined, 'INVALID_TRANSITION');

    const label = formatBatchNo(batch.batchNo);
    const expected = sumPaise(batch.items.map((item) => item.commissionCount));
    const commissionIds = (
      await Commission.find({ payoutBatchId: batch._id, status: 'processing' }, { _id: 1 }).session(session).lean()
    ).map((c) => c._id);
    if (commissionIds.length !== expected) throw inconsistent();

    const note = `Payout ${label} cancelled${reason ? `: ${reason}` : ''}`;
    const update = await Commission.updateMany(
      { _id: { $in: commissionIds }, payoutBatchId: batch._id, status: 'processing' },
      {
        $set: { status: 'approved', payoutBatchId: null },
        $push: { history: historyEntry({ from: 'processing', to: 'approved', actor, note }) },
      },
      { session },
    );
    if (update.modifiedCount !== expected) throw inconsistent();

    Object.assign(batch, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: actor.id,
      cancelReason: reason,
      openBatchKey: undefined,
    });
    await batch.save({ session });

    await recordAudit(
      [
        { actor, entity: 'PayoutBatch', entityId: batch._id, action: 'cancel', from: 'draft', to: 'cancelled', note: reason },
        ...commissionIds.map((cid) => ({ actor, entity: 'Commission', entityId: cid, action: 'unbatch', from: 'processing', to: 'approved', note: label })),
      ],
      session,
    );
    return batch;
  });
}

module.exports = {
  createBatch,
  listBatches,
  getBatch,
  getMissingPayoutDetails,
  exportBatchCsv,
  confirmBatch,
  cancelBatch,
};
