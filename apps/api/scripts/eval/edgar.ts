/**
 * SEC EDGAR client with disk cache.
 *
 * Sources:
 * - Ticker → CIK: https://www.sec.gov/files/company_tickers.json
 * - XBRL company facts: https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
 *
 * SEC requires a declared User-Agent and throttles to ~10 req/s.
 * We cache responses under ./cache so repeat eval runs are offline-friendly.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache');
const USER_AGENT = process.env.EDGAR_USER_AGENT ?? 'TaxPro Eval research@taxpro.ai';

mkdirSync(CACHE_DIR, { recursive: true });

function cachePath(name: string): string {
  return path.join(CACHE_DIR, name);
}

async function fetchJson(url: string, cacheName: string): Promise<any> {
  const cached = cachePath(cacheName);
  if (existsSync(cached)) {
    return JSON.parse(readFileSync(cached, 'utf-8'));
  }
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
  const data = await res.json();
  writeFileSync(cached, JSON.stringify(data));
  await new Promise(r => setTimeout(r, 200));
  return data;
}

export async function resolveCik(ticker: string): Promise<{ cik: string; name: string }> {
  const data = await fetchJson('https://www.sec.gov/files/company_tickers.json', 'company_tickers.json');
  const entry = Object.values(data).find(
    (e: any) => e.ticker?.toUpperCase() === ticker.toUpperCase(),
  ) as any;
  if (!entry) throw new Error(`Ticker ${ticker} not found in EDGAR`);
  return { cik: String(entry.cik_str).padStart(10, '0'), name: entry.title };
}

export async function fetchCompanyFacts(cik: string): Promise<any> {
  return fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, `facts_${cik}.json`);
}
