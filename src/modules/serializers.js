'use strict';

/**
 * Response shapes. Every API response goes through one of these, so secrets
 * (password hashes, encrypted payout details) can only reach a client if a
 * serializer explicitly adds them, and none does.
 */

const formatBatchNo = (batchNo) => `PB-${String(batchNo).padStart(4, '0')}`;

const id = (value) => (value ? String(value) : null);

function serializePayoutMethod(payoutMethod) {
  if (!payoutMethod?.type) return null;
  return { type: payoutMethod.type, masked: payoutMethod.masked, updatedAt: payoutMethod.updatedAt };
}

function serializeUser(user, { referralBaseUrl } = {}) {
  const isAffiliate = user.role === 'affiliate';
  const linkActive = isAffiliate && user.status === 'active';
  return {
    id: id(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    ...(isAffiliate && {
      promotionChannel: user.promotionChannel ?? null,
      promotionUrl: user.promotionUrl ?? null,
      rejectionReason: user.status === 'rejected' ? (user.rejectionReason ?? null) : null,
      deactivationReason: user.status === 'deactivated' ? (user.deactivationReason ?? null) : null,
      deactivatedBy: user.status === 'deactivated' ? (user.deactivatedByRole ?? null) : null,
      approvedAt: user.approvedAt ?? null,
      commissionRateBps: user.commissionRateBps ?? null,
      referralCode: user.referralCode ?? null,
      referralLinkActive: linkActive,
      referralLink: linkActive && referralBaseUrl ? `${referralBaseUrl}${encodeURIComponent(user.referralCode)}` : null,
      payoutMethod: serializePayoutMethod(user.payoutMethod),
    }),
  };
}

// A populated reference carries the user's fields; an unpopulated one is just an ObjectId.
const isPopulated = (ref) => Boolean(ref) && typeof ref === 'object' && typeof ref.email === 'string';

const affiliateRef = (affiliate) =>
  isPopulated(affiliate)
    ? { id: id(affiliate._id), name: affiliate.name, email: affiliate.email, referralCode: affiliate.referralCode ?? null }
    : { id: id(affiliate) };

function serializeCommission(commission, { includeHistory = false } = {}) {
  const wasRetried = commission.history?.some((h) => h.from === 'processing' && h.to === 'approved') ?? false;
  return {
    id: id(commission._id),
    affiliate: affiliateRef(commission.affiliateId),
    conversionId: id(commission.conversionId),
    orderAmountPaise: commission.orderAmountPaise,
    rateBps: commission.rateBps,
    amountPaise: commission.amountPaise,
    status: commission.status,
    rejectionReason: commission.rejectionReason ?? null,
    payoutBatchId: id(commission.payoutBatchId),
    retried: wasRetried,
    retryNote: wasRetried && commission.status === 'approved' ? 'Retrying in the next payout' : null,
    createdAt: commission.createdAt,
    updatedAt: commission.updatedAt,
    ...(includeHistory && {
      history: commission.history.map((h) => ({ from: h.from, to: h.to, actorId: id(h.actorId), at: h.at, note: h.note ?? null })),
    }),
  };
}

function serializeBatchItem(item) {
  const affiliate = item.affiliateId;
  return {
    affiliate: affiliateRef(affiliate),
    // Ops deactivated this affiliate after the batch was created: their payout is on hold.
    onHold: isPopulated(affiliate) && affiliate.status === 'deactivated' && affiliate.deactivatedByRole === 'ops',
    amountPaise: item.amountPaise,
    commissionCount: item.commissionCount,
    status: item.status,
    failureReason: item.failureReason ?? null,
  };
}

function serializeBatch(batch, { includeItems = true } = {}) {
  const failedCount = batch.items.filter((item) => item.status === 'failed').length;
  return {
    id: id(batch._id),
    batchNo: formatBatchNo(batch.batchNo),
    status: batch.status,
    originalTotalPaise: batch.originalTotalPaise,
    paidPaise: batch.paidPaise ?? null,
    failedPaise: batch.failedPaise ?? null,
    itemCount: batch.items.length,
    failedItemCount: failedCount,
    paymentReference: batch.paymentReference ?? null,
    createdAt: batch.createdAt,
    exportedAt: batch.exportedAt ?? null,
    paidAt: batch.paidAt ?? null,
    cancelledAt: batch.cancelledAt ?? null,
    cancelReason: batch.cancelReason ?? null,
    ...(includeItems && { items: batch.items.map(serializeBatchItem) }),
  };
}

const paginated = (items, { page, limit, total }) => ({ items, page, limit, total });

module.exports = { formatBatchNo, serializeUser, serializeCommission, serializeBatch, serializePayoutMethod, paginated };
