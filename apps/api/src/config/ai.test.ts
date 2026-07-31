import { describe, it, expect, vi, beforeEach } from 'vitest';

const { __setEnv, env: __env } = vi.hoisted(() => {
  const vals: Record<string, string | undefined> = {};
  return {
    __setEnv(k: string, v: string | undefined) {
      if (v === undefined) delete vals[k];
      else vals[k] = v;
    },
    env: new Proxy(vals, {
      get(_, prop) {
        if (typeof prop !== 'string') return undefined;
        return prop in vals ? vals[prop] : undefined;
      },
    }),
  };
});

vi.mock('../config/env.js', () => ({ env: __env }));

import { resolveConfig, resetAiConfig, isAiConfigured } from '../config/ai.js';

beforeEach(() => {
  resetAiConfig();
  for (const k of ['AI_PROVIDER', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'INTERFAZE_API_KEY', 'INTERFAZE_ENDPOINT', 'OPENAI_API_KEY']) {
    __setEnv(k, undefined);
  }
});

describe('AI provider config', () => {
  it('defaults to OpenAI with the default model when unset', () => {
    __setEnv('AI_API_KEY', 'sk-test');
    const cfg = resolveConfig();
    expect(cfg.provider).toBe('openai');
    expect(cfg.modelName).toBe('gpt-4o-mini');
    expect(cfg.baseUrl).toBe('https://api.openai.com/v1');
    expect(cfg.apiKey).toBe('sk-test');
  });

  it('resolves nvidia provider defaults', () => {
    __setEnv('AI_PROVIDER', 'nvidia');
    __setEnv('AI_API_KEY', 'nvapi-test');
    const cfg = resolveConfig();
    expect(cfg.provider).toBe('nvidia');
    expect(cfg.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(cfg.modelName).toBe('z-ai/glm-5.2');
  });

  it('resolves custom provider with explicit base URL and model', () => {
    __setEnv('AI_PROVIDER', 'custom');
    __setEnv('AI_BASE_URL', 'https://llm.internal.example/v1');
    __setEnv('AI_MODEL', 'internal-model-1');
    __setEnv('AI_API_KEY', 'sk-internal');
    const cfg = resolveConfig();
    expect(cfg.baseUrl).toBe('https://llm.internal.example/v1');
    expect(cfg.modelName).toBe('internal-model-1');
  });

  it('throws when custom provider has no base URL', () => {
    __setEnv('AI_PROVIDER', 'custom');
    __setEnv('AI_MODEL', 'm');
    __setEnv('AI_API_KEY', 'k');
    expect(() => resolveConfig()).toThrow(/AI_BASE_URL is required/);
  });

  it('throws when custom provider has no model', () => {
    __setEnv('AI_PROVIDER', 'custom');
    __setEnv('AI_BASE_URL', 'https://x/v1');
    __setEnv('AI_API_KEY', 'k');
    expect(() => resolveConfig()).toThrow(/AI_MODEL is required/);
  });

  it('throws when no API key is configured anywhere', () => {
    expect(() => resolveConfig()).toThrow(/No AI API key configured/);
  });

  it('falls back to OPENAI_API_KEY when AI_API_KEY is absent', () => {
    __setEnv('OPENAI_API_KEY', 'sk-legacy');
    const cfg = resolveConfig();
    expect(cfg.apiKey).toBe('sk-legacy');
  });

  it('uses INTERFAZE key and endpoint for the interfaze provider', () => {
    __setEnv('AI_PROVIDER', 'interfaze');
    __setEnv('INTERFAZE_API_KEY', 'sk-interfaze');
    __setEnv('INTERFAZE_ENDPOINT', 'https://api.interfaze.ai/custom');
    const cfg = resolveConfig();
    expect(cfg.apiKey).toBe('sk-interfaze');
    expect(cfg.baseUrl).toBe('https://api.interfaze.ai/custom');
  });

  it('reports isAiConfigured() without throwing', () => {
    expect(isAiConfigured()).toBe(false);
    __setEnv('AI_API_KEY', 'sk-test');
    expect(isAiConfigured()).toBe(true);
  });
});
