import React, { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { provision as provApi } from '../api/client';
import { RunStatusBadge } from '../components/RunStatusBadge';

interface RunSummary {
  run: any;
  openItems: any[];
  maxSeverity?: number;
}

export default function ReviewQueuePage() {
  const [queue, setQueue] = useState<RunSummary[]>([]);
  const [allRuns, setAllRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [q, runs] = await Promise.all([provApi.reviewQueue(), provApi.runs()]);
      setQueue(q);
      setAllRuns(runs);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load review data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading && queue.length === 0 && allRuns.length === 0) {
    return <p className="text-xs text-gray-500 font-sans">Loading review queue...</p>;
  }

  const latestPerPeriod = new Map<string, string>();
  for (const r of allRuns) {
    const key = r.period + '|' + (r.entityId || '');
    if (!latestPerPeriod.has(key)) latestPerPeriod.set(key, r.id);
  }
  const versionTotals = new Map<string, number>();
  for (const r of allRuns) {
    const key = r.period + '|' + (r.entityId || '');
    versionTotals.set(key, (versionTotals.get(key) ?? 0) + 1);
  }
  const versionSeen = new Map<string, number>();
  const versionOf = (r: any) => {
    const key = r.period + '|' + (r.entityId || '');
    const n = (versionSeen.get(key) ?? 0) + 1;
    versionSeen.set(key, n);
    return `${n}/${versionTotals.get(key)}`;
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex justify-between items-center pb-2 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-serif font-semibold text-[#0A192F] tracking-tight">CPA Review Queue & Governance</h2>
          <p className="text-xs text-gray-500 mt-1">Four-eye partner review, approval staging, and immutable run locking</p>
        </div>
        <button onClick={load} className="text-xs text-[#0A192F] font-semibold hover:underline bg-white border border-gray-200 px-3 py-1.5 rounded-button shadow-sm">Refresh Queue</button>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-card p-4 text-xs flex justify-between items-center font-medium">
          <span>{loadError}</span>
          <button onClick={load} className="text-red-800 font-semibold hover:underline ml-4 whitespace-nowrap">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-base font-serif font-semibold text-[#0A192F] mb-3 tracking-tight">Pending Partner Sign-off</h3>
          {queue.length === 0 ? (
            <div className="bg-white rounded-card border border-gray-200 p-6 text-center shadow-sm">
              <p className="text-gray-500 text-xs">No provision runs currently awaiting partner review.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {queue.map((q: any) => {
                const { run, openItems, maxSeverity } = q;
                const severityLabel = maxSeverity === 0 ? 'High Risk' : maxSeverity === 1 ? 'Medium Risk' : 'Low Risk';
                const severityColor = maxSeverity === 0 ? 'bg-red-50 text-red-700 border-red-200' : maxSeverity === 1 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200';
                return (
                  <button
                    key={run.id}
                    onClick={() => navigate({ to: '/runs/$runId', params: { runId: run.id } })}
                    className="w-full text-left bg-white rounded-card border border-gray-200 p-4 hover:border-[#0A192F] transition-all shadow-sm block"
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold text-sm text-[#0A192F]">{run.period}</span>
                      <RunStatusBadge status={run.status} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-button text-[10px] font-semibold border ${severityColor}`}>{severityLabel}</span>
                      <span className="text-xs text-gray-500 font-medium">{openItems.length} open review item(s)</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-base font-serif font-semibold text-[#0A192F] mb-3 tracking-tight">Provision Run Audit Trail</h3>
          {allRuns.length === 0 ? (
            <div className="bg-white rounded-card border border-gray-200 p-6 text-center shadow-sm">
              <p className="text-gray-500 text-xs">No provision runs yet — start one on the Provision page.</p>
            </div>
          ) : (
            <div className="bg-white rounded-card border border-gray-200 overflow-hidden shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-[#F8F9FA] border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Period</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Version</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Status</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Approval State</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allRuns.map((r: any) => {
                    const isLatest = r.id === latestPerPeriod.get(r.period + '|' + (r.entityId || ''));
                    return (
                      <tr key={r.id} onClick={() => navigate({ to: '/runs/$runId', params: { runId: r.id } })} className="hover:bg-[#F8F9FA] cursor-pointer transition-colors">
                        <td className="px-3 py-2.5 font-medium text-[#0A192F]">
                          <span>{r.period}</span>
                          {isLatest && <span className="ml-2 px-1.5 py-0.5 rounded-button text-[10px] font-semibold bg-[#E8F7F0] text-[#10B981] border border-[#10B981]/30">Latest</span>}
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 font-mono text-[11px]">{versionOf(r)}</td>
                        <td className="px-3 py-2.5"><RunStatusBadge status={r.status} /></td>
                        <td className="px-3 py-2.5 text-gray-600 font-medium">{r.approvalStatus?.replace(/_/g, ' ') ?? '—'}</td>
                        <td className="px-3 py-2.5 text-gray-500 font-mono text-[11px]">{new Date(r.createdAt).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
