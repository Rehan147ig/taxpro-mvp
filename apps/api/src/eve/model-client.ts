import { getAiClient } from '../config/ai.js';
import type { EveModelRequest, EveModelResponse } from './types.js';

const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 1000;
const REQUEST_TIMEOUT_MS = 15000;

export async function callJsonModel<T>(request: EveModelRequest): Promise<EveModelResponse<T>> {
  const { client, model, provider, supportsJsonMode } = getAiClient();
  const messages: { role: 'system' | 'user'; content: string }[] = [
    { role: 'system', content: request.system },
    { role: 'user', content: request.user },
  ];

  if (!supportsJsonMode) {
    messages[1] = {
      role: 'user',
      content: `${request.user}\n\nRespond only with valid JSON. Do not include markdown fences or explanatory text.`,
    };
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 4096,
        ...(supportsJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      }, { timeout: REQUEST_TIMEOUT_MS });

      const raw = response.choices[0]?.message?.content?.trim();
      if (!raw) throw new Error('AI provider returned an empty response');

      return { parsed: parseJson<T>(raw), raw, provider, model };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const status = (err as any)?.status;

      // Retry on rate limits and server errors
      if (status === 429 || (status >= 500 && status < 600)) {
        if (attempt < MAX_RETRIES) {
          const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          console.warn(`[Eve] API call failed (attempt ${attempt}), retrying in ${delay}ms...`, lastError.message);
          await sleep(delay);
          continue;
        }
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error('Max retries exceeded');
}

function parseJson<T>(raw: string): T {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/```(?:json)?\s*/gi, '').replace(/\s*```/g, '');
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    const preview = cleaned.slice(0, 500);
    throw new Error(`Failed to parse AI JSON response: ${preview}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
