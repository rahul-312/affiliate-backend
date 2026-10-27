'use strict';

/**
 * Minimal RFC 4180 CSV writer with spreadsheet formula-injection protection:
 * cells that a spreadsheet would evaluate (=, +, -, @, tab, CR) are prefixed
 * with a single quote. Numeric amount columns are written by the caller as
 * plain decimals and never start with those characters.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_TRIGGER.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** @param {string[]} header @param {Array<Array<unknown>>} rows */
function toCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { toCsv, escapeCell };
