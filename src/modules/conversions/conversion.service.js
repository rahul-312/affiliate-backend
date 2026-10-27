'use strict';

const { Conversion, Commission, User } = require('../../models');
const { calculateCommissionPaise } = require('../../utils/money');
const { runInTransaction } = require('../../utils/transaction');
const { conflict, unprocessable, isDuplicateKeyError } = require('../../utils/errors');
const { recordAudit } = require('../audit/audit.service');
const { getProgramSettings } = require('../program/program.service');
const { historyEntry } = require('../commissions/commissionStateMachine');

/** The fields that define a sale. A retry must match them exactly to be treated as the same event. */
const MATERIAL_FIELDS = Object.freeze(['referralCode', 'orderAmountPaise']);

function diffMaterialFields(stored, incoming) {
  return MATERIAL_FIELDS.filter((field) => stored[field] !== incoming[field]).map((field) => ({
    field,
    stored: stored[field],
    received: incoming[field],
  }));
}

/**
 * Resolves a request for an orderId that already exists:
 * identical payload → safe retry (returns the existing records);
 * different payload → 409 with the differing fields.
 */
async function resolveExistingOrder(existing, input) {
  const differences = diffMaterialFields(existing, input);
  if (differences.length > 0) {
    throw conflict(
      `Order ${input.orderId} was already recorded with different details`,
      { differences },
      'CONVERSION_CONFLICT',
    );
  }
  const commission = await Commission.findOne({ conversionId: existing._id });
  return { conversion: existing, commission, created: false };
}

async function findEligibleAffiliate(referralCode) {
  const affiliate = await User.findOne({ referralCode, role: 'affiliate' }).lean();
  if (!affiliate || affiliate.status !== 'active') {
    throw unprocessable('This referral code is not active, so the sale cannot earn a commission');
  }
  return affiliate;
}

/**
 * Records a sale and its pending commission, atomically and idempotently.
 *
 * - New orderId → conversion + commission + audit entry in one transaction (201).
 * - Same orderId and payload → existing records returned, nothing created (200).
 * - Same orderId, different payload → 409.
 *
 * A concurrent duplicate surfaces as a duplicate-key error that aborts the
 * transaction; it is handled outside the transaction attempt by re-reading
 * the stored conversion.
 *
 * @param {{orderId:string, referralCode:string, orderAmountPaise:number}} input
 * @param {{actor:{id:any, role:string}, source:'webhook'|'demo'}} meta
 * @param {{afterConversionWrite?: () => void}} [testHooks] fault injection for tests only
 */
async function recordConversion(input, { actor, source }, testHooks = {}) {
  const existing = await Conversion.findOne({ orderId: input.orderId });
  if (existing) return resolveExistingOrder(existing, input);

  const affiliate = await findEligibleAffiliate(input.referralCode);

  try {
    return await runInTransaction(async (session) => {
      const settings = await getProgramSettings(session);
      const conversion = await new Conversion({
        orderId: input.orderId,
        referralCode: input.referralCode,
        affiliateId: affiliate._id,
        orderAmountPaise: input.orderAmountPaise,
        source,
        createdBy: actor.id,
      }).save({ session });

      testHooks.afterConversionWrite?.();

      const commission = await new Commission({
        affiliateId: affiliate._id,
        conversionId: conversion._id,
        orderAmountPaise: input.orderAmountPaise,
        rateBps: settings.rateBps,
        amountPaise: calculateCommissionPaise(input.orderAmountPaise, settings.rateBps),
        status: 'pending',
        history: [historyEntry({ from: null, to: 'pending', actor, note: `Sale ${input.orderId} (${source})` })],
      }).save({ session });

      await recordAudit(
        [{ actor, entity: 'Commission', entityId: commission._id, action: 'create', to: 'pending', note: `order ${input.orderId}` }],
        session,
      );
      return { conversion, commission, created: true };
    });
  } catch (err) {
    if (!isDuplicateKeyError(err, 'orderId')) throw err;
    const stored = await Conversion.findOne({ orderId: input.orderId });
    if (!stored) throw err;
    return resolveExistingOrder(stored, input);
  }
}

const serializeConversionResult = ({ conversion, commission, created }) => ({
  created,
  conversion: {
    id: String(conversion._id),
    orderId: conversion.orderId,
    referralCode: conversion.referralCode,
    orderAmountPaise: conversion.orderAmountPaise,
    source: conversion.source,
    createdAt: conversion.createdAt,
  },
  commission: commission && {
    id: String(commission._id),
    status: commission.status,
    rateBps: commission.rateBps,
    amountPaise: commission.amountPaise,
  },
});

module.exports = { recordConversion, serializeConversionResult };
