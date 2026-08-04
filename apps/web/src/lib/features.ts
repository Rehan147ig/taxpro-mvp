import { useEffect, useState } from 'react';

export interface FeatureFlags {
  /** US ASC 740 workstream (dormant by default — TAXPRO_ENABLE_US=false). */
  enableUs: boolean;
}

let flagsPromise: Promise<FeatureFlags> | null = null;

/**
 * Fetch feature flags from the API. Fails closed to UK-first defaults so the
 * UI never flashes US-only features when the flags endpoint is unreachable.
 */
export function fetchFeatureFlags(): Promise<FeatureFlags> {
  if (!flagsPromise) {
    flagsPromise = fetch('/api/config/flags', { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : ({ enableUs: false } as FeatureFlags)))
      .catch(() => ({ enableUs: false } as FeatureFlags));
  }
  return flagsPromise;
}

export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>({ enableUs: false });
  useEffect(() => {
    fetchFeatureFlags().then(setFlags).catch(() => {});
  }, []);
  return flags;
}

/** True only when the US ASC 740 workstream is explicitly enabled. */
export function useEnableUs(): boolean {
  return useFeatureFlags().enableUs;
}
