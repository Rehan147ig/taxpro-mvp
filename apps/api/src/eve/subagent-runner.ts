import { withSpan } from '@superlog/otel-helpers';
import { startAiRun, completeAiRun, failAiRun, timeoutAiRun, fallbackAiRun } from './trace-store.js';
import { tracer, agentRunCounter } from '../lib/observability.js';

const DEFAULT_SUBAGENT_TIMEOUT_MS = 120_000;

export class SubagentTimeoutError extends Error {
  constructor(public readonly workflowName: string, timeoutMs: number) {
    super(`AI subagent ${workflowName} exceeded ${timeoutMs}ms timeout`);
    this.name = 'SubagentTimeoutError';
  }
}

export interface TracedSubagentArgs<Input, Output> {
  tenantId: string;
  userId?: string;
  provisionRunId: string;
  workflowName: string;
  promptVersion: string;
  input: Input;
  timeoutMs?: number;
  execute: (input: Input) => Promise<Output>;
}

export async function runTracedSubagent<Input, Output>(
  tx: any,
  args: TracedSubagentArgs<Input, Output>,
): Promise<Output> {
  const timeoutMs = args.timeoutMs ?? (Number(process.env.SUBAGENT_TIMEOUT_MS) || DEFAULT_SUBAGENT_TIMEOUT_MS);

  return withSpan(
    `subagent.${args.workflowName}`,
    async () => {
      const aiRun = await startAiRun(tx, {
        tenantId: args.tenantId,
        userId: args.userId,
        provisionRunId: args.provisionRunId,
        workflowName: args.workflowName,
        promptVersion: args.promptVersion,
      }, args.input);

      let output: Output;
      try {
        output = await Promise.race([
          args.execute(args.input),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new SubagentTimeoutError(args.workflowName, timeoutMs)), timeoutMs);
          }),
        ]);
      } catch (err) {
        if (err instanceof SubagentTimeoutError) {
          await timeoutAiRun(aiRun.id, err, tx);
          agentRunCounter.add(1, { workflow: args.workflowName, outcome: 'timeout' });
        } else {
          await failAiRun(aiRun.id, err, tx);
          agentRunCounter.add(1, { workflow: args.workflowName, outcome: 'failure' });
        }
        throw err;
      }

      if (
        typeof output === 'object' && output !== null && 'success' in output
        && (output as Record<string, unknown>).success === false
      ) {
        const reason = (output as Record<string, unknown>).error;
        await fallbackAiRun(aiRun.id, typeof reason === 'string' && reason.length > 0 ? reason : 'subagent returned failure', tx);
        agentRunCounter.add(1, { workflow: args.workflowName, outcome: 'fallback' });
        return output;
      }

      await completeAiRun(aiRun.id, output, tx);
      agentRunCounter.add(1, { workflow: args.workflowName, outcome: 'success' });
      return output;
    },
    {
      tracer,
      attributes: {
        'taxpro.tenant_id': args.tenantId,
        'taxpro.provision_run_id': args.provisionRunId,
        'taxpro.workflow_name': args.workflowName,
      },
    },
  );
}
