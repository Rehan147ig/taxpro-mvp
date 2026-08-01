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
  { key: 'all', label: 'All Mappings' },
  { key: 'draft', label: 'Draft Suggestions' },
  { key: 'active', label: 'Approved Active' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-amber-50 text-amber-800 border border-amber-200',
  active: 'bg-[#E8F7F0] text-[#10B981] border border-[#10B981]/30 font-medium',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
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
    setProgress('Enqueuing AI auto-mapping pipeline...');
    try {
      const { jobId } = await mappingApi.runAi();
      setProgress('AI classification in progress...');
      const poll = setInterval(async () => {
        try {
          const status = await mappingApi.status(jobId);
          if (status.progress?.mapped != null) {
            setProgress(`Classified ${status.progress.mapped} of ${status.progress.total} accounts...`);
          }
          if (status.state === 'completed' || status.state === 'failed') {
            clearInterval(poll);
            setProgress(status.state === 'completed' ? 'Classification complete' : 'Classification failed');
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
        overrideReason: 'Approved by CPA Reviewer',
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
    if (num >= 0.8) return 'bg-[#E8F7F0] text-[#10B981] font-semibold border border-[#10B981]/30';
    if (num >= 0.5) return 'bg-amber-50 text-amber-800 border border-amber-200';
    return 'bg-red-50 text-red-700 border border-red-200';
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex justify-between items-center pb-2 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-serif font-semibold text-[#0A192F] tracking-tight">Tax Account Mapping & Precedents</h2>
          <p className="text-xs text-gray-500 mt-1">GL account classification workspace with human-in-the-loop approval</p>
        </div>
        <div className="flex items-center gap-3">
          {progress && (
            <span className="text-xs font-mono text-gray-500 bg-white border border-gray-200 px-3 py-1.5 rounded-button">{progress}</span>
          )}
          <button
            onClick={handleRunAi}
            disabled={runLoading}
            className="bg-[#0A192F] text-white px-4 py-2 rounded-button text-xs font-medium hover:bg-[#112240] disabled:opacity-50 transition-colors shadow-sm"
          >
            {runLoading ? 'Classifying...' : 'Run AI Auto-Mapping'}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-0">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-all duration-150 ${
              activeTab === tab.key
                ? 'border-[#0A192F] text-[#0A192F] font-semibold'
                : 'border-transparent text-gray-500 hover:text-[#0A192F]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-gray-500">Loading mapping rules...</p>
      ) : mappings.length === 0 ? (
        <div className="bg-white rounded-card border border-gray-200 p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-[#0A192F] mb-1">No mappings found</p>
          <p className="text-xs text-gray-400">
            {activeTab === 'draft' ? 'No draft suggestions pending. Run AI mapping to generate candidates.' :
             activeTab === 'rejected' ? 'No rejected account mappings.' :
             'Sync NetSuite or upload trial balance data, then run AI mapping.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-card border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-[#F8F9FA] border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-[#0A192F]">Account ID</th>
                <th className="text-left px-4 py-3 font-semibold text-[#0A192F]">Tax Category</th>
                <th className="text-left px-4 py-3 font-semibold text-[#0A192F]">Treatment</th>
                <th className="text-left px-4 py-3 font-semibold text-[#0A192F]">Timing Category</th>
                <th className="text-left px-4 py-3 font-semibold text-[#0A192F]">Confidence</th>
                <th className="text-left px-4 py-3 font-semibold text-[#0A192F]">Source</th>
                <th className="text-left px-4 py-3 font-semibold text-[#0A192F]">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-[#0A192F]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {mappings.map((m) => (
                <React.Fragment key={m.id}>
                  <tr
                    className="hover:bg-[#F8F9FA] cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                  >
                    <td className="px-4 py-3 font-mono text-[11px] text-[#0A192F]">{m.accountId.slice(0, 8)}...</td>
                    <td className="px-4 py-3 font-medium text-[#0A192F]">{m.taxAccountType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-button text-[11px] font-medium border ${
                        m.bookTreatment === 'permanent' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                        m.bookTreatment === 'temporary' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        'bg-gray-100 text-gray-700 border-gray-200'
                      }`}>
                        {m.bookTreatment}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-[11px]">{m.timingCategory ?? '—'}</td>
                    <td className="px-4 py-3">
                      {m.confidenceScore ? (
                        <span className={`px-2 py-0.5 rounded-button text-[11px] ${getConfidenceColor(m.confidenceScore)}`}>
                          {Math.round(parseFloat(m.confidenceScore) * 100)}%
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-medium">
                      {m.suggestedByAi ? 'AI Engine' : 'CPA Override'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-button text-[11px] ${STATUS_STYLES[m.status] || 'bg-gray-100 text-gray-700'}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {m.status === 'draft' && (
                        <div className="flex gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleApprove(m); }}
                            disabled={actionLoading === m.id}
                            className="text-[11px] bg-[#0A192F] text-white px-2.5 py-1 rounded-button hover:bg-[#112240] disabled:opacity-50 font-medium transition-colors"
                          >
                            {actionLoading === m.id ? '...' : 'Approve'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReject(m); }}
                            disabled={actionLoading === m.id}
                            className="text-[11px] bg-red-700 text-white px-2.5 py-1 rounded-button hover:bg-red-800 disabled:opacity-50 font-medium transition-colors"
                          >
                            {actionLoading === m.id ? '...' : 'Reject'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedId === m.id && (
                    <tr key={`${m.id}-detail`} className="bg-[#F8F9FA] border-b border-gray-200">
                      <td colSpan={8} className="px-6 py-4">
                        <div className="grid grid-cols-2 gap-6">
                          {m.aiExplanation && (
                            <div>
                              <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1 font-sans">AI Provenance & Tax Rationale</h4>
                              <p className="text-xs text-[#0A192F] whitespace-pre-wrap leading-relaxed">{m.aiExplanation}</p>
                            </div>
                          )}
                          <div>
                            <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1 font-sans">Audit Metadata</h4>
                            <div className="space-y-1 text-xs text-gray-600">
                              <p><strong className="text-[#0A192F]">Version:</strong> {m.version}</p>
                              <p><strong className="text-[#0A192F]">Source:</strong> {m.suggestedByAi ? 'AI Suggestion' : 'CPA Override'}</p>
                              <p><strong className="text-[#0A192F]">Precedent Active:</strong> {m.isActive ? 'Yes' : 'No'}</p>
                              {m.overrideReason && <p><strong className="text-[#0A192F]">Override Reason:</strong> {m.overrideReason}</p>}
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
