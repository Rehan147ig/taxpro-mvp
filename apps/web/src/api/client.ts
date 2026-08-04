const BASE_URL = '/api';

// Store token in localStorage for persistence
export function getToken(): string | null {
  return localStorage.getItem('taxpro_token');
}

export function setToken(token: string) {
  localStorage.setItem('taxpro_token', token);
}

export function clearToken() {
  localStorage.removeItem('taxpro_token');
}

export async function apiClient<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: 'Request failed' }));
    // Genericize access-denied errors to avoid leaking internal details
    if (res.status === 403 || res.status === 401) {
      throw new Error('You do not have access to this provision or its records.');
    }
    if (res.status === 409) {
      throw new Error(errorBody.error || 'This action cannot be completed because the provision is locked.');
    }
    throw new Error(errorBody.error || `HTTP ${res.status}`);
  }

  return res.json();
}

async function textClient(path: string): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function blobClient(path: string): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

// Auth
export const auth = {
  register: (payload: { email: string; password: string; tenantName: string; tenantSlug: string }) =>
    apiClient<{ token: string; tenant: { id: string; name: string; slug: string } }>('/auth/register', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  login: (payload: { email: string; password: string }) =>
    apiClient<{ token: string; tenant: { id: string; name: string; slug: string } }>('/auth/login', {
      method: 'POST', body: JSON.stringify(payload),
    }),
};

// Connections
export const connections = {
  list: () => apiClient<any[]>('/netsuite/connections'),
  create: (payload: any) => apiClient<any>('/netsuite/connections', { method: 'POST', body: JSON.stringify(payload) }),
  sync: (id: string) => apiClient<any>(`/netsuite/connections/${id}/sync`, { method: 'POST' }),
};

// Universal imports
export const imports = {
  trialBalanceTemplate: () => textClient('/import/trial-balance/template'),
  trialBalance: (payload: { csv: string; source?: string }) =>
    apiClient<{ importedRows: number; accounts: number; source: string }>('/import/trial-balance', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// Mappings
export const mappings = {
  list: (status?: string) => apiClient<any[]>(`/mapping/mappings${status ? `?status=${status}` : ''}`),
  runAi: () => apiClient<{ jobId: string; message: string }>('/mapping/mappings/run-ai', { method: 'POST' }),
  status: (jobId: string) => apiClient<{ jobId: string; state: string; progress: any; result: any }>(`/mapping/mappings/status/${jobId}`),
  override: (accountId: string, payload: any) =>
    apiClient<any>(`/mapping/mappings/${accountId}/override`, { method: 'POST', body: JSON.stringify(payload) }),
  reject: (accountId: string, reason?: string) =>
    apiClient<any>(`/mapping/mappings/${accountId}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
};

export interface AiAgentRun {
  workflowName: string;
  status: string;
  promptVersion: string;
  provider: string | null;
  model: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  output: any;
}

// Provision
export const provision = {
  entities: () => apiClient<{ id: string; name: string; type: string; currency: string | null; taxJurisdiction: string | null }[]>('/provision/entities'),
  run: (payload: { period: string; endPeriod?: string; entityId?: string }) =>
    apiClient<any>('/provision/run', { method: 'POST', body: JSON.stringify(payload) }),
  results: () => apiClient<any[]>('/provision/results'),
  exportResult: (id: string) => blobClient(`/provision/results/${id}/export`),
  exportPackage: (id: string) => blobClient(`/provision/results/${id}/package`),
  runs: () => apiClient<any[]>('/provision/runs'),
  runReviewItems: (runId: string) => apiClient<any[]>(`/provision/runs/${runId}/review-items`),
  aiFindings: (runId: string) =>
    apiClient<{ provisionRunId: string; pending: boolean; agents: AiAgentRun[] }>(`/provision/runs/${runId}/ai-findings`),
  resolveItem: (runId: string, itemId: string, payload: { resolution: string; resolutionNote?: string }) =>
    apiClient<any>(`/provision/runs/${runId}/review-items/${itemId}/resolve`, { method: 'POST', body: JSON.stringify(payload) }),
  bulkResolve: (runId: string, payload: { resolution: string; resolutionNote?: string }) =>
    apiClient<any>(`/provision/runs/${runId}/review-items/bulk-resolve`, { method: 'POST', body: JSON.stringify(payload) }),
  finalize: (runId: string) =>
    apiClient<any>(`/provision/runs/${runId}/finalize`, { method: 'POST' }),
  submitForApproval: (runId: string) =>
    apiClient<any>(`/provision/runs/${runId}/submit-for-approval`, { method: 'POST' }),
  partnerApprove: (runId: string) =>
    apiClient<any>(`/provision/runs/${runId}/partner-approve`, { method: 'POST' }),
  lockRun: (runId: string) =>
    apiClient<any>(`/provision/runs/${runId}/lock`, { method: 'POST' }),
  unlockRun: (runId: string) =>
    apiClient<any>(`/provision/runs/${runId}/unlock`, { method: 'POST' }),
  resultDetail: (id: string) => apiClient<any>(`/provision/results/${id}`),
  ct600: (id: string, format: 'json' | 'csv' = 'json') =>
    format === 'csv'
      ? textClient(`/provision/results/${id}/ct600?format=csv`)
      : apiClient<any>(`/provision/results/${id}/ct600`),
  rdClaim: (id: string) => apiClient<any>(`/provision/results/${id}/rd-claim`),
  mtdReadiness: (id: string, flags: { agentAuthorised?: boolean; signedUp?: boolean; softwareConnected?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (flags.agentAuthorised) q.set('agentAuthorised', 'true');
    if (flags.signedUp) q.set('signedUp', 'true');
    if (flags.softwareConnected) q.set('softwareConnected', 'true');
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return apiClient<any>(`/provision/results/${id}/mtd-readiness${suffix}`);
  },
  ctoXml: (id: string) => textClient(`/provision/results/${id}/cto-xml`),
  runTrialBalanceDetail: (runId: string) =>
    apiClient<any[]>(`/provision/runs/${runId}/trial-balance-detail`),
  compare: (runId: string) =>
    apiClient<{ currentPeriod: string; previousPeriod: string | null; current: any; previous: any; delta: any }>(`/provision/runs/${runId}/compare`),
  reviewQueue: () => apiClient<any[]>('/provision/review/queue'),
  eveAsk: (prompt: string) =>
    apiClient<{ answer: string; suggestedAction?: string }>('/provision/eve/ask', { method: 'POST', body: JSON.stringify({ prompt }) }),
  events: (runId: string) =>
    apiClient<any[]>(`/provision/runs/${runId}/events`),
};

// Phase B: entity groups + accounting/tax periods
export const periods = {
  groups: () => apiClient<any[]>('/periods/groups'),
  accounting: () => apiClient<any[]>('/periods/accounting'),
  tax: () => apiClient<any[]>('/periods/tax'),
  createGroup: (payload: { name: string; description?: string; parentGroupId?: string }) =>
    apiClient<any>('/periods/groups', { method: 'POST', body: JSON.stringify(payload) }),
  createAccounting: (payload: { entityId: string; name: string; startDate: string; endDate: string; periodType?: string }) =>
    apiClient<any>('/periods/accounting', { method: 'POST', body: JSON.stringify(payload) }),
  createTax: (payload: { entityId: string; accountingPeriodId?: string; startDate: string; endDate: string; status?: string }) =>
    apiClient<any>('/periods/tax', { method: 'POST', body: JSON.stringify(payload) }),
};

// Phase B: source-document artefact store
export const documents = {
  list: () => apiClient<any[]>('/documents'),
  upload: (file: File, documentType: string, entityId?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('documentType', documentType);
    if (entityId) form.append('entityId', entityId);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch('/api/documents', { method: 'POST', body: form, headers }).then((res) => {
      if (!res.ok) return res.json().then((b) => Promise.reject(new Error(b.error || `HTTP ${res.status}`)));
      return res.json();
    });
  },
  detail: (id: string) => apiClient<any>(`/documents/${id}`),
  replace: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`/api/documents/${id}/replace`, { method: 'POST', body: form, headers }).then((res) => {
      if (!res.ok) return res.json().then((b) => Promise.reject(new Error(b.error || `HTTP ${res.status}`)));
      return res.json();
    });
  },
  download: (id: string) => blobClient(`/documents/${id}/download`),
};

// Phase B: mapping proposals
export const proposals = {
  list: (status?: string) => apiClient<any[]>(`/mappings/proposals${status ? `?status=${status}` : ''}`),
  create: (payload: any) => apiClient<any>('/mappings/proposals', { method: 'POST', body: JSON.stringify(payload) }),
  decide: (id: string, payload: { decision: 'approved' | 'rejected'; reason: string }) =>
    apiClient<any>(`/mappings/proposals/${id}/decide`, { method: 'POST', body: JSON.stringify(payload) }),
  carryForward: (entityId: string) =>
    apiClient<any>('/mappings/proposals/carry-forward', { method: 'POST', body: JSON.stringify({ entityId }) }),
};

// Phase B: UK rules registry
export const rules = {
  list: () => apiClient<any[]>('/rules'),
  propose: (payload: any) => apiClient<any>('/rules/proposals', { method: 'POST', body: JSON.stringify(payload) }),
  approve: (id: string) => apiClient<any>(`/rules/${id}/approve`, { method: 'POST' }),
  rollback: (id: string, rationale: string) =>
    apiClient<any>(`/rules/${id}/rollback`, { method: 'POST', body: JSON.stringify({ rationale }) }),
  supersede: (id: string, payload: any) => apiClient<any>(`/rules/${id}/supersede`, { method: 'POST', body: JSON.stringify(payload) }),
};

// Phase B: review lifecycle
export const reviewItems = {
  list: (status?: string) => apiClient<any[]>(`/review-items${status ? `?status=${status}` : ''}`),
  detail: (id: string) => apiClient<{ item: any; events: any[] }>(`/review-items/${id}`),
  update: (id: string, payload: { ownerUserId?: string; dueDate?: string; evidenceRequested?: string }) =>
    apiClient<any>(`/review-items/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  start: (id: string) => apiClient<any>(`/review-items/${id}/start`, { method: 'POST' }),
  requestEvidence: (id: string, evidenceRequested: string) =>
    apiClient<any>(`/review-items/${id}/request-evidence`, { method: 'POST', body: JSON.stringify({ evidenceRequested }) }),
  attachEvidence: (id: string, documentId: string) =>
    apiClient<any>(`/review-items/${id}/attach-evidence`, { method: 'POST', body: JSON.stringify({ documentId }) }),
  waive: (id: string, reason: string) =>
    apiClient<any>(`/review-items/${id}/waive`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reopen: (id: string, reason: string) =>
    apiClient<any>(`/review-items/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
