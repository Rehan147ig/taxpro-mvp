import { describe, it, expect } from 'vitest';
import { normalizeCompanyNumber } from './validator.js';

describe('normalizeCompanyNumber', () => {

  it('pads numeric-only to 8 digits', () => {
    expect(normalizeCompanyNumber('502851')).toBe('00502851');
  });

  it('pads numeric with leading zeros already present', () => {
    expect(normalizeCompanyNumber('00502851')).toBe('00502851');
  });

  it('handles Greggs plc (502851)', () => {
    expect(normalizeCompanyNumber('502851')).toBe('00502851');
  });

  it('handles BT plc (1800000)', () => {
    expect(normalizeCompanyNumber('1800000')).toBe('01800000');
  });

  it('preserves SC prefix and pads numeric part to 6', () => {
    expect(normalizeCompanyNumber('SC123')).toBe('SC000123');
  });

  it('preserves SC prefix with full 6 digits', () => {
    expect(normalizeCompanyNumber('SC123456')).toBe('SC123456');
  });

  it('preserves NI prefix and pads numeric part to 6', () => {
    expect(normalizeCompanyNumber('NI123')).toBe('NI000123');
  });

  it('trims whitespace and uppercases', () => {
    expect(normalizeCompanyNumber(' sc123 ')).toBe('SC000123');
  });

  it('removes spaces within the number', () => {
    expect(normalizeCompanyNumber('SC 123')).toBe('SC000123');
  });

  it('throws 400 for empty string', () => {
    expect(() => normalizeCompanyNumber('')).toThrow('Company number is required');
  });

  it('throws 400 for non-digit characters in numeric part', () => {
    expect(() => normalizeCompanyNumber('ABCDEFG')).toThrow('Invalid company number');
  });

  it('throws 400 for letters after SC prefix in numeric part', () => {
    expect(() => normalizeCompanyNumber('SC12AB')).toThrow('Invalid company number');
  });

  it('throws 400 for number exceeding 8 digits', () => {
    expect(() => normalizeCompanyNumber('123456789')).toThrow('up to 8 digits allowed');
  });

  it('throws 400 for SC prefix with more than 6 digits', () => {
    expect(() => normalizeCompanyNumber('SC1234567')).toThrow('allows up to 6 digits');
  });

  it('handles exactly 8 digit numeric', () => {
    expect(normalizeCompanyNumber('12345678')).toBe('12345678');
  });

  it('handles single digit numeric', () => {
    expect(normalizeCompanyNumber('1')).toBe('00000001');
  });

  it('throws 400 for entirely non-alphanumeric', () => {
    expect(() => normalizeCompanyNumber('!!!')).toThrow('Invalid company number');
  });

  describe('injection / security edge cases', () => {

    it('throws on SQL injection: 1; DROP TABLE', () => {
      expect(() => normalizeCompanyNumber("1'; DROP TABLE companies; --")).toThrow('Invalid company number');
    });

    it('throws on SQL injection: SC\' OR \'1\'=\'1', () => {
      expect(() => normalizeCompanyNumber("SC' OR '1'='1")).toThrow('Invalid company number');
    });

    it('throws on XSS: <script>alert(1)</script>', () => {
      expect(() => normalizeCompanyNumber('<script>alert(1)</script>')).toThrow('Invalid company number');
    });

    it('throws on XSS with HTML entities', () => {
      expect(() => normalizeCompanyNumber('&lt;img src=x onerror=alert(1)&gt;')).toThrow('Invalid company number');
    });

    it('strips newlines from input rather than throwing (sanitizes safely)', () => {
      expect(normalizeCompanyNumber('SC123\n456')).toBe('SC123456');
    });

    it('throws on very long string (DoS prevention)', () => {
      expect(() => normalizeCompanyNumber('1'.repeat(1000))).toThrow('up to 8 digits allowed');
    });

    it('throws on UTF-8 normalization attack (homoglyph)', () => {
      expect(() => normalizeCompanyNumber('SС123')).toThrow('Invalid company number');
    });

    it('throws on path traversal in number', () => {
      expect(() => normalizeCompanyNumber('../../etc/passwd')).toThrow('Invalid company number');
    });

    it('throws on null byte injection', () => {
      expect(() => normalizeCompanyNumber('SC123\x00')).toThrow('Invalid company number');
    });

    it('throws on unicode math symbols', () => {
      expect(() => normalizeCompanyNumber('SC¹²³')).toThrow('Invalid company number');
    });

    it('throws on control characters', () => {
      expect(() => normalizeCompanyNumber('SC\x01\x02')).toThrow('Invalid company number');
    });

  });
});
