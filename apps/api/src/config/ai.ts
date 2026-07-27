import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { env } from './env.js';

/**
 * AI provider configuration (Vercel AI SDK).
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
  model: LanguageModel;
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
function resolveConfig(): AiConfig {
  if (cachedConfig) return cachedConfig;

  const provider = env.AI_PROVIDER || 'openai';
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;

  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No AI API key configured. Set AI_API_KEY (or OPENAI_API_KEY) in .env',
    );
  }

  const baseUrl = env.AI_BASE_URL || defaults.baseUrl;
  if (!baseUrl && provider === 'custom') {
    throw new Error('AI_BASE_URL is required when AI_PROVIDER=custom');
  }

  const modelName = env.AI_MODEL || defaults.model;
  if (!modelName && provider === 'custom') {
    throw new Error('AI_MODEL is required when AI_PROVIDER=custom');
  }

  // Native OpenAI provider for api.openai.com; OpenAI-compatible provider
  // (chat completions) for NVIDIA / custom gateways that lack the Responses API.
  const model: LanguageModel = provider === 'openai' && !env.AI_BASE_URL
    ? createOpenAI({ apiKey })(modelName)
    : createOpenAICompatible({ name: provider, apiKey, baseURL: baseUrl })(modelName);

  cachedConfig = { model, modelName, provider };
  return cachedConfig;
}

/**
 * Get the configured AI SDK language model.
 * Throws if no API key is set.
 */
export function getAiModel(): AiConfig {
  return resolveConfig();
}

/**
 * Clear the cached config (useful in tests).
 */
export function resetAiConfig() {
  cachedConfig = null;
}
