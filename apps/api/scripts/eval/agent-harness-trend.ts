/**
 * Agent Harness Trend Log — append-only JSONL history of harness runs.
 *
 * The data file (agent-harness-trend.jsonl) is git-ignored; a .gitkeep
 * placeholder keeps the directory tracked. Override the path with
 * AGENT_HARNESS_TREND_FILE for CI sandboxes.
 */
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TREND_LOG_PATH = process.env.AGENT_HARNESS_TREND_FILE
  ?? path.join(__dirname, 'agent-harness-trend.jsonl');

export interface TrendLine {
  timestamp: string;
  mode: 'dry-run' | 'mocked' | 'real';
  provider: string;
  model: string;
  fixtures: number;
  invocations: number;
  fallbacks: number;
  fallbackRate: number;
  overall: 'PASS' | 'FAIL';
  note?: string;
  durationMs: number;
  byAgent: Record<string, { ok: number; total: number; fallbacks: number }>;
}

export function recordTrendLine(line: TrendLine): void {
  try {
    mkdirSync(path.dirname(TREND_LOG_PATH), { recursive: true });
    appendFileSync(TREND_LOG_PATH, `${JSON.stringify(line)}\n`, 'utf8');
  } catch (err) {
    console.error(`Trend log write failed (${TREND_LOG_PATH}): ${err instanceof Error ? err.message : err}`);
  }
}

export function loadRecentRuns(n = 5): TrendLine[] {
  if (!existsSync(TREND_LOG_PATH)) return [];
  const lines = readFileSync(TREND_LOG_PATH, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try { return JSON.parse(l) as TrendLine; } catch { return null; }
    })
    .filter((l): l is TrendLine => l !== null);
  return lines.slice(-n);
}

export function printRecentRuns(n = 5): void {
  const runs = loadRecentRuns(n);
  console.log(`\nRecent harness runs (last ${Math.min(runs.length, n)}):`);
  if (runs.length === 0) {
    console.log('  (no trend data yet)');
    return;
  }
  for (const r of runs) {
    const rate = (r.fallbackRate * 100).toFixed(1);
    console.log(
      `  ${r.timestamp}  mode=${r.mode.padEnd(7)} ${r.provider}/${r.model}  ` +
      `${r.fixtures} fixtures  fallback ${r.fallbacks}/${r.invocations} (${rate}%)  ${r.overall}`,
    );
  }
}
