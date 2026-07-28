import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache');
const API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
const BASE_URL = 'https://api.company-information.service.gov.uk';
const USER_AGENT = process.env.COMPANIES_HOUSE_USER_AGENT ?? 'TaxPro Eval research@taxpro.ai';

mkdirSync(CACHE_DIR, { recursive: true });

function cachePath(name: string): string {
  return path.join(CACHE_DIR, name);
}

async function fetchJson(url: string, cacheName: string): Promise<any> {
  const cached = cachePath(cacheName);
  if (existsSync(cached)) {
    return JSON.parse(readFileSync(cached, 'utf-8'));
  }
  if (process.env.OFFLINE) {
    throw new Error(`OFFLINE mode: no cached data for ${cacheName}`);
  }
  if (!API_KEY) {
    throw new Error('COMPANIES_HOUSE_API_KEY not set');
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${API_KEY}:`).toString('base64')}`,
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Companies House ${res.status} for ${url}`);
  const data = await res.json();
  writeFileSync(cached, JSON.stringify(data));
  await new Promise(r => setTimeout(r, 500));
  return data;
}

export interface CompanySearchResult {
  company_number: string;
  title: string;
  company_status: string;
  company_type: string;
}

export async function searchCompany(name: string): Promise<CompanySearchResult[]> {
  const data = await fetchJson(
    `${BASE_URL}/search/companies?q=${encodeURIComponent(name)}`,
    `search_${name.replace(/[^a-zA-Z0-9]/g, '_')}.json`,
  );
  return (data.items ?? []).map((item: any) => ({
    company_number: item.company_number,
    title: item.title,
    company_status: item.company_status,
    company_type: item.company_type,
  }));
}

const ACTUAL_ACCOUNTS_TYPES = new Set([
  'AA', 'FULL', 'GROUP', 'SMALL', 'MEDIUM',
]);

const MAY_LACK_TAX_NOTE = new Set([
  'AA-A', 'DORMANT', 'MICRO', 'MICRO-ACCOUNTS', 'MICRO_ACCOUNTS',
]);

interface FilingItem {
  date: string;
  description: string;
  documentMetadataUrl: string;
  type: string;
  mayLackTaxNote: boolean;
}

export async function getAccountsFilings(companyNumber: string): Promise<FilingItem[]> {
  const data = await fetchJson(
    `${BASE_URL}/company/${companyNumber}/filing-history?category=accounts`,
    `filings_${companyNumber}.json`,
  );
  const allItems: FilingItem[] = (data.items ?? []).map((item: any): FilingItem => {
    const type = (item.type ?? '').toUpperCase();
    return {
      date: item.date,
      description: item.description ?? '',
      documentMetadataUrl: item.links?.document_metadata ?? '',
      type,
      mayLackTaxNote: MAY_LACK_TAX_NOTE.has(type),
    };
  });
  return allItems.filter(item =>
    ACTUAL_ACCOUNTS_TYPES.has(item.type) || MAY_LACK_TAX_NOTE.has(item.type),
  );
}

interface DocumentInfo {
  pdfUrl: string | null;
  ixbrlUrl: string | null;
}

export async function getDocumentUrl(documentMetadataUrl: string): Promise<DocumentInfo> {
  const url = documentMetadataUrl.startsWith('http')
    ? documentMetadataUrl
    : `${BASE_URL}${documentMetadataUrl}`;
  const docId = url.split('/').pop();
  const data = await fetchJson(url, `doc_${docId}.json`);
  const pdfUrl = data.links?.document ?? null;
  const docBaseUrl = url.replace(/\/document\/[^/]+$/, '');
  const ixbrlUrl = (data.resources ?? {})['application/xhtml+xml']
    ? `${docBaseUrl}/document/${docId}/application/xhtml+xml`
    : null;
  return { pdfUrl, ixbrlUrl };
}
