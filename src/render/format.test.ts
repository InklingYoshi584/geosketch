import { describe, expect, it } from 'vitest';
import { formatNumber } from './format';

describe('formatNumber', () => {
  it('writes a plain measure with two decimals', () => {
    expect(formatNumber(2.5, undefined)).toBe('2.50');
    expect(formatNumber(1 / 3, undefined)).toBe('0.33');
  });

  it('writes an angle with one decimal and a degree sign', () => {
    expect(formatNumber(45, 'deg')).toBe('45.0°');
    expect(formatNumber(44.96, 'deg')).toBe('45.0°');
  });

  it('turns a label into a prefix', () => {
    expect(formatNumber(2.5, undefined, 'AB')).toBe('AB = 2.50');
    expect(formatNumber(45, 'deg', '∠A')).toBe('∠A = 45.0°');
  });

  it('leaves a missing or empty label unprefixed', () => {
    expect(formatNumber(2.5, undefined, '')).toBe('2.50');
    expect(formatNumber(2.5, undefined, undefined)).toBe('2.50');
  });

  it('keeps a negative value signed', () => {
    expect(formatNumber(-1.5, undefined)).toBe('-1.50');
  });
});
