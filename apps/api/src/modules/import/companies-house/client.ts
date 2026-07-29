import { env } from '../../../config/env.js';
import { NotFoundError } from '../../../lib/errors.js';
import { normalizeCompanyNumber } from './validator.js';

const BASE_URL = 'https://api.company-information.service.gov.uk';
const USER_AGENT = 'TaxPro/1.0 (companies-house-import; research@taxpro.ai)';

function authHeader(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) throw new Error('COMPANIES_HOUSE_API_KEY not set');
  return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

export interface CHProfile {
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  companyType: string;
  dateOfIncorporation: string;
  registeredOfficeAddress: {
    addressLine1: string;
    locality: string;
    postalCode: string;
    country: string;
  };
  sicCodes: string[];
  jurisdiction: string;
  accounts?: {
    nextAccounts: { periodEndOn: string };
    accountingReferenceDate: { day: string; month: string };
    lastAccounts?: { madeUpTo: string; periodEndOn: string };
  };
}

export interface RateLimitError extends Error {
  retryAfter: number;
}

export function isRateLimitError(err: unknown): err is RateLimitError {
  return err instanceof Error && 'retryAfter' in err && typeof (err as any).retryAfter === 'number';
}

export async function fetchCompanyProfile(rawNumber: string): Promise<CHProfile> {
  const companyNumber = normalizeCompanyNumber(rawNumber);
  const url = `${BASE_URL}/company/${companyNumber}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader(),
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? 60);
      const err = new Error(`Companies House rate limited (429). Retry after ${retryAfter}s`) as RateLimitError;
      err.retryAfter = retryAfter;
      throw err;
    }

    if (res.status === 404) {
      throw new NotFoundError('Company', companyNumber);
    }

    if (!res.ok) {
      throw new Error(`Companies House ${res.status} for ${companyNumber}`);
    }

    const raw = await res.json() as any;

    return {
      companyNumber: String(raw.company_number ?? companyNumber),
      companyName: String(raw.company_name ?? ''),
      companyStatus: String(raw.company_status ?? ''),
      companyType: String(raw.type ?? ''),
      dateOfIncorporation: String(raw.date_of_incorporation ?? ''),
      registeredOfficeAddress: {
        addressLine1: String(raw.registered_office_address?.address_line_1 ?? ''),
        locality: String(raw.registered_office_address?.locality ?? ''),
        postalCode: String(raw.registered_office_address?.postal_code ?? ''),
        country: String(raw.registered_office_address?.country ?? ''),
      },
      sicCodes: Array.isArray(raw.sic_codes) ? raw.sic_codes.map(String) : [],
      jurisdiction: String(raw.jurisdiction ?? ''),
      accounts: raw.accounts
        ? {
            nextAccounts: {
              periodEndOn: String(raw.accounts.next_made_up_to ?? raw.accounts.next_accounts?.period_end_on ?? ''),
            },
            accountingReferenceDate: {
              day: String(raw.accounts.accounting_reference_date?.day ?? ''),
              month: String(raw.accounts.accounting_reference_date?.month ?? ''),
            },
            lastAccounts: raw.accounts.last_accounts
              ? {
                  madeUpTo: String(raw.accounts.last_accounts.made_up_to ?? ''),
                  periodEndOn: String(raw.accounts.last_accounts.period_end_on ?? ''),
                }
              : undefined,
          }
        : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}
