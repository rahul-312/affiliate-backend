'use strict';

const { calculateCommissionPaise, paiseToRupeeString, formatInr } = require('../../src/utils/money');

describe('calculateCommissionPaise', () => {
  it('computes 10% of ₹5,000 as ₹500', () => {
    expect(calculateCommissionPaise(500000, 1000)).toBe(50000);
  });

  it('rounds half up to the nearest paise', () => {
    expect(calculateCommissionPaise(5, 1000)).toBe(1); // 0.5 → 1
    expect(calculateCommissionPaise(4, 1000)).toBe(0); // 0.4 → 0
    expect(calculateCommissionPaise(15, 1000)).toBe(2); // 1.5 → 2
    expect(calculateCommissionPaise(12345, 1250)).toBe(1543); // 1543.125 → 1543
    expect(calculateCommissionPaise(12348, 1250)).toBe(1544); // 1543.5 → 1544
  });

  it('handles zero amounts and zero rates', () => {
    expect(calculateCommissionPaise(0, 1000)).toBe(0);
    expect(calculateCommissionPaise(500000, 0)).toBe(0);
  });

  it('is exact for very large amounts', () => {
    expect(calculateCommissionPaise(Number.MAX_SAFE_INTEGER, 1)).toBe(900719925474);
    expect(calculateCommissionPaise(10_000_000_000, 1000)).toBe(1_000_000_000);
  });

  it('rejects non-integer or negative input', () => {
    expect(() => calculateCommissionPaise(10.5, 1000)).toThrow(TypeError);
    expect(() => calculateCommissionPaise(-1, 1000)).toThrow(TypeError);
    expect(() => calculateCommissionPaise(100, 10.1)).toThrow(TypeError);
  });
});

describe('formatting', () => {
  it('converts paise to a plain rupee string', () => {
    expect(paiseToRupeeString(50000)).toBe('500.00');
    expect(paiseToRupeeString(5)).toBe('0.05');
    expect(paiseToRupeeString(123456789)).toBe('1234567.89');
  });

  it('formats INR with Indian digit grouping', () => {
    expect(formatInr(500000)).toBe('₹5,000.00');
    expect(formatInr(123456789)).toBe('₹12,34,567.89');
    expect(formatInr(0)).toBe('₹0.00');
  });
});
