import { BadRequestError } from '../../../lib/errors.js';

const PREFIXED_JURISDICTIONS = new Set(['SC', 'NI', 'OE', 'SO', 'SF']);

export function normalizeCompanyNumber(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/\s/g, '');
  if (!cleaned) {
    throw new BadRequestError('Company number is required');
  }

  const prefix = PREFIXED_JURISDICTIONS.has(cleaned.slice(0, 2)) ? cleaned.slice(0, 2) : '';
  const numericPart = prefix ? cleaned.slice(2) : cleaned;

  if (!/^\d+$/.test(numericPart)) {
    throw new BadRequestError(`Invalid company number "${input}": must contain only digits${prefix ? ` after "${prefix}" prefix` : ''}`);
  }

  if (numericPart.length > (prefix ? 6 : 8)) {
    throw new BadRequestError(`Invalid company number "${input}": ${prefix ? `${prefix} prefix allows up to 6 digits` : 'up to 8 digits allowed'}`);
  }

  const padded = prefix
    ? `${prefix}${numericPart.padStart(6, '0')}`
    : numericPart.padStart(8, '0');

  if (!/^[A-Z0-9]{1,8}$/.test(padded)) {
    throw new BadRequestError(`Invalid company number "${input}": normalized to "${padded}" which exceeds 8 characters`);
  }

  return padded;
}
