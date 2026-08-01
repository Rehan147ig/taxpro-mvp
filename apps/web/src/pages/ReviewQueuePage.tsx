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
    return <p className="text-gray-500">Loading review queue...</p>;
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
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h2 className="text-2xl font-bold">Review Queue</h2>
        <button onClick={load} className="text-sm text-brand-600 hover:text-brand-700">Refresh</button>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-4 text-sm flex justify-between items-center">
          <span>{loadError}</span>
          <button onClick={load} className="text-red-700 font-medium hover:underline ml-4 whitespace-nowrap">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 overflow-auto">
        <div>
          <h3 className="font-semibold mb-3">Needs Review</h3>
          {queue.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
              <p className="text-gray-500 text-sm">No runs awaiting review</p>
            </div>
          ) : (
            <div className="space-y-3">
              {queue.map((q: any) => {
                const { run, openItems, maxSeverity } = q;
                const severityLabel = maxSeverity === 0 ? 'High' : maxSeverity === 1 ? 'Medium' : 'Low';
                const severityColor = maxSeverity === 0 ? 'bg-red-100 text-red-700' : maxSeverity === 1 ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700';
                return (
                  <button
                    key={run.id}
                    onClick={() => navigate({ to: '/runs/$runId', params: { runId: run.id } })}
                    className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-brand-300 transition"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-medium">{run.period}</span>
                      <RunStatusBadge status={run.status} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${severityColor}`}>{severityLabel} Priority</span>
                      <span className="text-xs text-gray-500">{openItems.length} open item(s)</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <h3 className="font-semibold mb-3">All Runs</h3>
          {allRuns.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
              <p className="text-gray-500 text-sm">No provision runs yet — start one on the Provision page.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Period</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Version</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Approval</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {allRuns.map((r: any) => {
                    const isLatest = r.id === latestPerPeriod.get(r.period + '|' + (r.entityId || ''));
                    return (
                      <tr key={r.id} onClick={() => navigate({ to: '/runs/$runId', params: { runId: r.id } })} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                        <td className="px-3 py-2">
                          <span>{r.period}</span>
                          {isLatest && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-100 text-brand-700">Latest</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{versionOf(r)}</td>
                        <td className="px-3 py-2"><RunStatusBadge status={r.status} /></td>
                        <td className="px-3 py-2 text-xs text-gray-500">{r.approvalStatus?.replace(/_/g, ' ') ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
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
