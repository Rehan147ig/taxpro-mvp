import type { EveRunContext, EveTool } from './types.js';
import { recordAiStep } from './trace-store.js';

export class EveRuntime {
  private sequence = 0;

  constructor(
    private readonly context: EveRunContext,
    private readonly aiRunId?: string,
  ) {}

  async runTool<I, O>(tool: EveTool<I, O>, input: I): Promise<O> {
    const output = await tool.execute(input, this.context);
    if (this.aiRunId) {
      this.sequence += 1;
      await recordAiStep(this.aiRunId, this.sequence, tool.name, input, output);
    }
    return output;
  }
}
