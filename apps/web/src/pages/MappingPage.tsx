import React, { useEffect, useState } from 'react';
import { mappings as mappingApi } from '../api/client';

interface TaxMapping {
  id: string;
  accountId: string;
  taxAccountType: string;
  taxSubType: string | null;
  bookTreatment: string;
  timingCategory: string | null;
  confidenceScore: string | null;
  suggestedByAi: boolean;
  aiExplanation: string | null;
  overrideReason: string | null;
  isActive: boolean;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

type FilterTab = 'all' | 'draft' | 'active' | 'rejected';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'active', label: 'Active' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-700',
  active: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function MappingPage() {
  const [mappings, setMappings] = useState<TaxMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [runLoading, setRunLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = async () => {
    try {
      const statusParam = activeTab === 'all' ? undefined : activeTab;
      const data = await mappingApi.list(statusParam);
      setMappings(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeTab]);

  const handleRunAi = async () => {
    setRunLoading(true);
    setProgress('Enqueuing mapping job...');
    try {
      const { jobId } = await mappingApi.runAi();
      setProgress('Mapping in progress...');
      const poll = setInterval(async () => {
        try {
          const status = await mappingApi.status(jobId);
          if (status.progress?.mapped != null) {
            setProgress(`Mapped ${status.progress.mapped} of ${status.progress.total} accounts...`);
          }
          if (status.state === 'completed' || status.state === 'failed') {
            clearInterval(poll);
            setProgress(status.state === 'completed' ? 'Mapping complete' : 'Mapping failed');
            load();
            setRunLoading(false);
          }
        } catch {
          clearInterval(poll);
          setRunLoading(false);
        }
      }, 2000);
    } catch (err: any) {
      setProgress(null);
      alert(err.message);
      setRunLoading(false);
    }
  };

  const handleApprove = async (m: TaxMapping) => {
    setActionLoading(m.id);
    try {
      await mappingApi.override(m.accountId, {
        taxAccountType: m.taxAccountType,
        bookTreatment: m.bookTreatment,
        timingCategory: m.timingCategory || undefined,
        overrideReason: 'Approved by CPA',
      });
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (m: TaxMapping) => {
    const reason = prompt('Rejection reason (optional):');
    if (reason === null) return;
    setActionLoading(m.id);
    try {
      await mappingApi.reject(m.accountId, reason || undefined);
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const getConfidenceColor = (score: string | null) => {
    const num = score ? parseFloat(score) : 0;
    if (num >= 0.8) return 'bg-green-100 text-green-700';
    if (num >= 0.5) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Tax Account Mapping</h2>
        <div className="flex items-center gap-3">
          {progress && (
            <span className="text-sm text-gray-500">{progress}</span>
          )}
          <button
            onClick={handleRunAi}
            disabled={runLoading}
            className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {runLoading ? 'Running...' : 'Run AI Mapping'}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === tab.key
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading mappings...</p>
      ) : mappings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500 mb-2">No mappings found</p>
          <p className="text-sm text-gray-400">
            {activeTab === 'draft' ? 'No draft mappings. Run AI mapping to generate suggestions.' :
             activeTab === 'rejected' ? 'No rejected mappings.' :
             'Connect NetSuite and sync data first, then run AI mapping'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Account ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Tax Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Treatment</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Timing</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Confidence</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Source</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <React.Fragment key={m.id}>
                  <tr
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{m.accountId.slice(0, 8)}...</td>
                    <td className="px-4 py-3">{m.taxAccountType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        m.bookTreatment === 'permanent' ? 'bg-purple-100 text-purple-700' :
                        m.bookTreatment === 'temporary' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {m.bookTreatment}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{m.timingCategory ?? '—'}</td>
                    <td className="px-4 py-3">
                      {m.confidenceScore ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs ${getConfidenceColor(m.confidenceScore)}`}>
                          {Math.round(parseFloat(m.confidenceScore) * 100)}%
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {m.suggestedByAi ? 'AI' : 'Manual'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLES[m.status] || 'bg-gray-100 text-gray-700'}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {m.status === 'draft' && (
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleApprove(m); }}
                            disabled={actionLoading === m.id}
                            className="text-xs bg-brand-600 text-white px-2 py-1 rounded hover:bg-brand-700 disabled:opacity-50"
                          >
                            {actionLoading === m.id ? '...' : 'Approve'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReject(m); }}
                            disabled={actionLoading === m.id}
                            className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 disabled:opacity-50"
                          >
                            {actionLoading === m.id ? '...' : 'Reject'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedId === m.id && (
                    <tr key={`${m.id}-detail`} className="bg-gray-50 border-b border-gray-200">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          {m.aiExplanation && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">AI Rationale</h4>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.aiExplanation}</p>
                            </div>
                          )}
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Provenance</h4>
                            <div className="space-y-1 text-sm text-gray-600">
                              <p>Version: {m.version}</p>
                              <p>Source: {m.suggestedByAi ? 'AI Suggestion' : 'Manual Override'}</p>
                              <p>Active: {m.isActive ? 'Yes' : 'No'}</p>
                              {m.overrideReason && <p>Reason: {m.overrideReason}</p>}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
