import { startMappingWorker } from './modules/mapping/ai/worker.js';
import { startAutoMappingWorker } from './modules/import/auto-mapping/auto-mapping.worker.js';
import { startCHWorker } from './modules/import/companies-house/worker.js';
import { startAgentPipelineWorker } from './agent/orchestrator/state-machine.js';
import { logger } from './lib/logger.js';

export interface WorkerHandles {
  closeAll: () => Promise<void>;
}

export function startAllWorkers(): WorkerHandles {
  const mappingWorker = startMappingWorker();
  logger.info('[API] Mapping worker started');

  const autoMappingWorker = startAutoMappingWorker();
  logger.info('[API] Auto-mapping worker started');

  const chWorker = startCHWorker();
  logger.info('[API] Companies House worker started');

  const agentPipelineWorker = startAgentPipelineWorker();
  logger.info('[API] Agent pipeline worker started');

  return {
    closeAll: async () => {
      await chWorker.close();
      await autoMappingWorker.close();
      await mappingWorker.close();
      await agentPipelineWorker.close();
    },
  };
}
