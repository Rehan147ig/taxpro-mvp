import { env } from './env.js';

/**
 * AI provider configuration — direct OpenAI-compatible HTTP client.
 *
 * TaxPro talks to any OpenAI-compatible chat-completions endpoint directly
 * (no Vercel AI SDK, no Vercel hosting dependency). Supported providers:
 *   AI_PROVIDER  = openai | nvidia | interfaze | custom
 *   AI_BASE_URL  = https://integrate.api.nvidia.com/v1  (for nvidia)
 *   AI_API_KEY   = nvapi-... or sk-...
 *   AI_MODEL     = gpt-4o-mini | z-ai/glm-5.2 | ...
 *
 * Interfaze (multimodal parsing) reads from INTERFAZE_API_KEY and INTERFAZE_ENDPOINT.
 * Defaults to OpenAI if nothing is configured.
 *
 * SECURITY: API keys are read from process.env only. Never log or print keys.
 */

export const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'z-ai/glm-5.2',
  },
  interfaze: {
    baseUrl: 'https://api.interfaze.ai/v1',
    model: 'gpt-4o-mini',
  },
  custom: {
    baseUrl: '',
    model: '',
  },
};

export interface AiConfig {
  /** Base URL for chat-completions, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  modelName: string;
  provider: string;
}

let cachedConfig: AiConfig | null = null;

/**
 * Resolve the AI config from environment variables.
 *
 * Priority:
 *   AI_PROVIDER + AI_BASE_URL + AI_API_KEY + AI_MODEL  → primary
 *   OPENAI_API_KEY                                      → legacy fallback
 */
export function resolveConfig(): AiConfig {
  if (cachedConfig) return cachedConfig;

  const provider = env.AI_PROVIDER || 'openai';
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;

  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  let modelName: string | undefined;

  if (provider === 'interfaze') {
    apiKey = env.INTERFAZE_API_KEY || env.AI_API_KEY;
    baseUrl = env.INTERFAZE_ENDPOINT || env.AI_BASE_URL || defaults.baseUrl;
    modelName = env.AI_MODEL || defaults.model;
  } else {
    apiKey = env.AI_API_KEY || env.OPENAI_API_KEY;
    baseUrl = env.AI_BASE_URL || defaults.baseUrl;
    modelName = env.AI_MODEL || defaults.model;
  }

  if (!apiKey) {
    throw new Error(
      'No AI API key configured. Set AI_API_KEY (or INTERFAZE_API_KEY) in .env',
    );
  }

  if (!baseUrl && provider === 'custom') {
    throw new Error('AI_BASE_URL is required when AI_PROVIDER=custom');
  }

  if (!modelName && provider === 'custom') {
    throw new Error('AI_MODEL is required when AI_PROVIDER=custom');
  }

  cachedConfig = { baseUrl: baseUrl!, apiKey, modelName: modelName!, provider };
  return cachedConfig;
}

/**
 * Get the resolved AI provider config.
 * Throws if no API key is set.
 */
export function getAiModel(): AiConfig {
  return resolveConfig();
}

/**
 * True when an AI provider key is configured and calls may be made.
 * Safe to call without throwing.
 */
export function isAiConfigured(): boolean {
  if (cachedConfig) return true;
  const provider = env.AI_PROVIDER || 'openai';
  if (provider === 'interfaze') {
    return Boolean(env.INTERFAZE_API_KEY || env.AI_API_KEY);
  }
  return Boolean(env.AI_API_KEY || env.OPENAI_API_KEY);
}

/**
 * Clear the cached config (useful in tests).
 */
export function resetAiConfig() {
  cachedConfig = null;
}
