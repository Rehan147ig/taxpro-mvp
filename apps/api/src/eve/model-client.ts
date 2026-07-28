import { generateObject } from 'ai';
import type { z } from 'zod';
import { getAiModel } from '../config/ai.js';
import type { EveModelRequest, EveModelResponse } from './types.js';

const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Call the configured LLM and return a zod-validated structured response.
 *
 * Built on the Vercel AI SDK `generateObject` — the provider enforces the
 * JSON schema and the SDK handles retries, so no hand-rolled parsing or
 * backoff lives here anymore.
 */
function resolveTemperature(request: EveModelRequest): number {
  if (request.temperature !== undefined) return request.temperature;
  if (request.promptVersion.startsWith('mapping-') || request.promptVersion.startsWith('audit-') || request.promptVersion.startsWith('parser-')) {
    return 0.0;
  }
  if (request.promptVersion.startsWith('explanation-')) {
    return 0.1;
  }
  return 0.1;
}

export async function callJsonModel<S extends z.ZodType>(
  request: EveModelRequest & { schema: S },
): Promise<EveModelResponse<z.infer<S>>> {
  const { model, modelName, provider } = getAiModel();

  const result = await generateObject({
    model,
    schema: request.schema,
    system: request.system,
    prompt: request.user,
    temperature: resolveTemperature(request),
    maxOutputTokens: request.maxTokens ?? 4096,
    maxRetries: MAX_RETRIES,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  return {
    parsed: result.object as z.infer<S>,
    raw: JSON.stringify(result.object),
    provider,
    model: modelName,
  };
}
