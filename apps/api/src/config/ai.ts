import OpenAI from 'openai';
import { env } from './env.js';

/**
 * AI provider configuration.
 *
 * Supports any OpenAI-compatible API by setting:
 *   AI_PROVIDER  = openai | nvidia | custom
 *   AI_BASE_URL  = https://integrate.api.nvidia.com/v1  (for nvidia)
 *   AI_API_KEY   = nvapi-... or sk-...
 *   AI_MODEL     = gpt-4o-mini | z-ai/glm-5.2 | ...
 *
 * Defaults to OpenAI if nothing is configured.
 */

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'z-ai/glm-5.2',
  },
  custom: {
    baseUrl: '',
    model: '',
  },
};

export interface AiConfig {
  client: OpenAI;
  model: string;
  supportsJsonMode: boolean;
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
function resolveConfig(): AiConfig {
  if (cachedConfig) return cachedConfig;

  const provider = env.AI_PROVIDER || 'openai';
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;

  // Resolve API key
  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No AI API key configured. Set AI_API_KEY (or OPENAI_API_KEY) in .env',
    );
  }

  // Resolve base URL
  const baseUrl = env.AI_BASE_URL || defaults.baseUrl;
  if (!baseUrl && provider === 'custom') {
    throw new Error('AI_BASE_URL is required when AI_PROVIDER=custom');
  }

  // Resolve model name
  const model = env.AI_MODEL || defaults.model;
  if (!model && provider === 'custom') {
    throw new Error('AI_MODEL is required when AI_PROVIDER=custom');
  }

  // Not all providers support response_format: { type: 'json_object' }
  const supportsJsonMode = provider === 'openai';

  const client = new OpenAI({ apiKey, baseURL: baseUrl });

  cachedConfig = { client, model, supportsJsonMode, provider };
  return cachedConfig;
}

/**
 * Get the configured AI client.
 * Throws if no API key is set.
 */
export function getAiClient(): AiConfig {
  return resolveConfig();
}

/**
 * Clear the cached config (useful in tests).
 */
export function resetAiConfig() {
  cachedConfig = null;
}
