'use strict';

const { createFieldCipher } = require('../../src/utils/fieldEncryption');
const { maskPayoutDetails } = require('../../src/utils/payoutMethod');
const { escapeCell, toCsv } = require('../../src/utils/csv');
const { canTransition } = require('../../src/modules/commissions/commissionStateMachine');

describe('field encryption', () => {
  const cipher = createFieldCipher('b'.repeat(64));

  it('round-trips a value and never stores it in clear', () => {
    const details = { type: 'bank', accountNumber: '123456784821', ifsc: 'HDFC0001234' };
    const sealed = cipher.encrypt(details);
    expect(sealed).not.toContain('123456784821');
    expect(cipher.decrypt(sealed)).toEqual(details);
  });

  it('uses a fresh IV per encryption', () => {
    expect(cipher.encrypt({ a: 1 })).not.toBe(cipher.encrypt({ a: 1 }));
  });

  it('detects tampering', () => {
    const [v, iv, tag, data] = cipher.encrypt({ a: 1 }).split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(() => cipher.decrypt([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });

  it('rejects a wrong key', () => {
    const other = createFieldCipher('c'.repeat(64));
    expect(() => other.decrypt(cipher.encrypt({ a: 1 }))).toThrow();
  });
});

describe('payout detail masking', () => {
  it('masks UPI ids and account numbers', () => {
    expect(maskPayoutDetails({ type: 'upi', upiId: 'rahul@okhdfc' })).toBe('UPI: ra***@okhdfc');
    expect(maskPayoutDetails({ type: 'bank', accountNumber: '123456784821' })).toBe('Bank: ****4821');
  });
});

describe('CSV writer', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(escapeCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(escapeCell('+91')).toBe("'+91");
    expect(escapeCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('quotes commas, quotes and newlines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'he said "hi"']])).toBe('a,b\r\n"x,y","he said ""hi"""\r\n');
  });
});

describe('commission state machine', () => {
  it.each([
    ['pending', 'approved', true],
    ['pending', 'rejected', true],
    ['approved', 'processing', true],
    ['processing', 'paid', true],
    ['processing', 'approved', true],
    ['paid', 'approved', false],
    ['rejected', 'approved', false],
    ['pending', 'paid', false],
    ['approved', 'paid', false],
  ])('%s → %s allowed: %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });
});
