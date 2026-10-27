'use strict';

/**
 * Masking for payout details. Only the masked form is ever stored in clear
 * text or returned by the API; full details live encrypted and are decrypted
 * only for the finance CSV export.
 */

function maskUpiId(upiId) {
  const [handle, provider] = upiId.split('@');
  const visible = handle.slice(0, Math.min(2, Math.max(handle.length - 1, 1)));
  return `UPI: ${visible}***@${provider}`;
}

function maskAccountNumber(accountNumber) {
  return `Bank: ****${accountNumber.slice(-4)}`;
}

/** @param {{type:'upi',upiId:string}|{type:'bank',accountNumber:string}} details */
function maskPayoutDetails(details) {
  return details.type === 'upi' ? maskUpiId(details.upiId) : maskAccountNumber(details.accountNumber);
}

module.exports = { maskPayoutDetails };
