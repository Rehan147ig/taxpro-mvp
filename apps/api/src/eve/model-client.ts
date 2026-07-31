import type { z } from 'zod';
import { getAiModel } from '../config/ai.js';
import type { EveModelRequest, EveModelResponse } from './types.js';
import { logger } from '../lib/logger.js';

/**
 * Eve model client — direct OpenAI-compatible chat-completions client.
 *
 * No Vercel AI SDK: TaxPro calls {baseUrl}/chat/completions directly, parses
 * the JSON response, and validates it against the caller's zod schema.
 *
 * Behavior:
 *  - Retries transient failures (429, 5xx, network, timeout) with backoff.
 *  - Enforces a per-attempt timeout.
 *  - Fails loudly (InvalidOutputError) on malformed JSON or schema violations —
 *    never silently coerces AI output.
 */

export const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAYS_MS = [300, 800];

/** Overridable client options (used by tests to keep them fast). */
export interface EveClientOptions {
  timeoutMs?: number;
  retryDelaysMs?: number[];
  maxRetries?: number;
}

let clientOptions: Required<EveClientOptions> = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  retryDelaysMs: DEFAULT_RETRY_DELAYS_MS,
  maxRetries: MAX_RETRIES,
};

export function configureEveClient(options: EveClientOptions) {
  clientOptions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryDelaysMs: options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
    maxRetries: options.maxRetries ?? MAX_RETRIES,
  };
}

/** Raised when the provider is unreachable or returns a non-2xx status after retries. */
export class ModelRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ModelRequestError';
  }
}

/** Raised when the provider's output is not valid JSON or fails zod validation. */
export class InvalidOutputError extends Error {
  constructor(message: string, readonly raw?: string) {
    super(message);
    this.name = 'InvalidOutputError';
  }
}

function isRetryable(status: number | undefined, error: unknown): boolean {
  if (status !== undefined) return status === 429 || status >= 500;
  if (error instanceof ModelRequestError) return true;
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'TypeError');
}

async function delay(ms: number) {
  await new Promise(r => setTimeout(r, ms));
}

function resolveTemperature(request: EveModelRequest): number {
  if (request.temperature !== undefined) return request.temperature;
  if (request.promptVersion.startsWith('mapping-') || request.promptVersion.startsWith('audit-') || request.promptVersion.startsWith('parser-')) {
    return 0.0;
  }
  return 0.1;
}

export async function callJsonModel<S extends z.ZodType>(
  request: EveModelRequest & { schema: S },
): Promise<EveModelResponse<z.infer<S>>> {
  const { baseUrl, apiKey, modelName, provider } = getAiModel();

  const body = {
    model: modelName,
    temperature: resolveTemperature(request),
    max_tokens: request.maxTokens ?? 4096,
    response_format: { type: 'json_object' as const },
    messages: [
      { role: 'system' as const, content: `${request.system}\n\nYou must respond with ONLY valid JSON matching the requested schema. No markdown, no code fences.` },
      { role: 'user' as const, content: request.user },
    ],
  };

  const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const maxRetries = clientOptions.maxRetries;
  const delays = clientOptions.retryDelaysMs;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = delays[Math.min(attempt - 1, delays.length - 1)] ?? delays[delays.length - 1] ?? 500;
      await delay(backoff);
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(clientOptions.timeoutMs),
      });

      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        lastError = new ModelRequestError(`Model request failed with status ${res.status}: ${detail}`, res.status);
        if (!isRetryable(res.status, lastError)) break;
        continue;
      }

      const payload = await res.json().catch((err) => {
        throw new InvalidOutputError(`Model returned unparseable body: ${err instanceof Error ? err.message : String(err)}`);
      });

      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new InvalidOutputError('Model returned an empty or malformed choices payload');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        throw new InvalidOutputError(`Model returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`, content);
      }

      const result = request.schema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues.slice(0, 5).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        throw new InvalidOutputError(`Model output failed zod validation: ${issues}`, content);
      }

      return {
        parsed: result.data as z.infer<S>,
        raw: content,
        provider,
        model: modelName,
      };
    } catch (err) {
      if (err instanceof Error && !(err instanceof ModelRequestError) && !(err instanceof InvalidOutputError) && isRetryable(undefined, err)) {
        lastError = new ModelRequestError(`Model request failed: ${err.message}`, undefined);
      } else {
        lastError = err;
      }
      if (!isRetryable(lastError instanceof ModelRequestError ? lastError.status : undefined, lastError)) throw lastError;
      logger.warn({ err: lastError, attempt }, '[Eve] Model request attempt failed, retrying');
    }
  }

  throw lastError instanceof Error ? lastError : new ModelRequestError(String(lastError));
}
