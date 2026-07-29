import { normalizeCompanyNumber } from './validator.js';
import { addCHJob } from './queue.js';

export interface QueueCHImportInput {
  companyNumber: string;
  tenantId: string;
  runId?: string;
  userId: string;
}

export interface QueueCHImportResult {
  status: 'queued';
  companyNumber: string;
  jobId: string;
}

export async function queueCompaniesHouseImport(input: QueueCHImportInput): Promise<QueueCHImportResult> {
  const normalized = normalizeCompanyNumber(input.companyNumber);
  const jobId = await addCHJob(normalized, input.tenantId, input.userId, input.runId);

  return {
    status: 'queued',
    companyNumber: normalized,
    jobId,
  };
}
