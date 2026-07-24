export type EveRunStatus = 'started' | 'completed' | 'failed';

export interface EveRunContext {
  tenantId: string;
  userId?: string;
  provisionRunId?: string;
  workflowName: string;
  promptVersion?: string;
}

export interface EveModelRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  promptVersion: string;
}

export interface EveModelResponse<T> {
  parsed: T;
  raw: string;
  provider: string;
  model: string;
}

export interface EveTool<I, O> {
  name: string;
  description: string;
  execute: (input: I, context: EveRunContext) => Promise<O>;
}
