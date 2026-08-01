import React, { useEffect, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { provision as provApi } from '../api/client';
import AiFindingsPanel from '../components/AiFindingsPanel';
import EveAdvisor from '../components/EveAdvisor';

export default function AiFindingsPage() {
  const { runId } = useParams({ from: '/runs/$runId/findings' });
  const [run, setRun] = useState<any | null>(null);
  const [findings, setFindings] = useState<{ pending: boolean; agents: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [runs, f] = await Promise.all([provApi.runs(), provApi.aiFindings(runId)]);
      setRun(runs.find((r: any) => r.id === runId) ?? null);
      setFindings(f);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load AI findings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [runId]);

  useEffect(() => {
    if (!findings?.pending) return;
    const timer = setTimeout(async () => {
      try {
        setFindings(await provApi.aiFindings(runId));
      } catch { /* retry on next poll cycle */ }
    }, 4000);
    return () => clearTimeout(timer);
  }, [runId, findings]);

  const auditMemo = findings?.agents?.find((a: any) => a.workflowName === 'subagent_audit_defense')?.output;

  const downloadMemo = () => {
    if (!auditMemo) return;
    const blob = new Blob([JSON.stringify(auditMemo, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-memo-${run?.period || 'run'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !findings) {
    return <p className="text-gray-500">Loading AI findings...</p>;
  }

  return (
    <div>
      <div className="mb-2">
        <Link to="/runs/$runId" params={{ runId }} className="text-xs text-gray-500 hover:text-gray-700">← Back to Run Detail</Link>
      </div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">AI Findings{run ? ` — ${run.period}` : ''}</h2>
        {auditMemo && (
          <button onClick={downloadMemo} className="text-sm text-brand-600 hover:underline">Download Memo</button>
        )}
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-4 text-sm flex justify-between items-center">
          <span>{loadError}</span>
          <button onClick={load} className="text-red-700 font-medium hover:underline ml-4 whitespace-nowrap">Retry</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-200 bg-gray-50 shrink-0">
            <h3 className="font-semibold text-gray-800">Audit Documentation</h3>
            {findings?.pending && <p className="text-xs text-yellow-600 mt-1">Subagents still running — auto-refreshing...</p>}
          </div>
          <div className="p-4">
            <AiFindingsPanel findings={findings} />
          </div>
        </div>
        <EveAdvisor />
      </div>
    </div>
  );
}
