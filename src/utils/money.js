'use strict';

/**
 * Money rules. All amounts are integers in paise and all rates are integers in
 * basis points; no floating point ever touches a stored amount. BigInt keeps
 * the multiplication exact even for very large orders.
 */

const BPS_DENOMINATOR = 10_000n;
const HALF_UP_OFFSET = 5_000n;
const PAISE_PER_RUPEE = 100;

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer (got ${value})`);
  }
}

/**
 * commissionPaise = floor((amountPaise * rateBps + 5000) / 10000)
 * i.e. rounded half up to the nearest paise.
 */
function calculateCommissionPaise(amountPaise, rateBps) {
  assertNonNegativeInteger(amountPaise, 'amountPaise');
  assertNonNegativeInteger(rateBps, 'rateBps');
  const result = (BigInt(amountPaise) * BigInt(rateBps) + HALF_UP_OFFSET) / BPS_DENOMINATOR;
  return Number(result);
}

/** 50000 -> "500.00" (plain decimal, used in CSV exports). */
function paiseToRupeeString(paise) {
  if (!Number.isSafeInteger(paise)) throw new TypeError(`paise must be a safe integer (got ${paise})`);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / PAISE_PER_RUPEE);
  const fraction = String(abs % PAISE_PER_RUPEE).padStart(2, '0');
  return `${sign}${rupees}.${fraction}`;
}

/** 500000 -> "₹5,000.00" (Indian digit grouping, for display). */
function formatInr(paise) {
  const [whole, fraction] = paiseToRupeeString(paise).split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${lastThree}` : lastThree;
  return `${negative ? '-' : ''}₹${grouped}.${fraction}`;
}

const sumPaise = (values) => values.reduce((total, value) => total + value, 0);

module.exports = { calculateCommissionPaise, paiseToRupeeString, formatInr, sumPaise };
