import React, { useEffect, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { provision as provApi } from '../api/client';
import AuditTrailList from '../components/AuditTrailList';

export default function AuditEventsPage() {
  const { runId } = useParams({ from: '/runs/$runId/audit' });
  const [run, setRun] = useState<any | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [runs, evs] = await Promise.all([provApi.runs(), provApi.events(runId)]);
      setRun(runs.find((r: any) => r.id === runId) ?? null);
      setEvents(evs);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load audit events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [runId]);

  return (
    <div>
      <div className="mb-2">
        <Link to="/runs/$runId" params={{ runId }} className="text-xs text-gray-500 hover:text-gray-700">← Back to Run Detail</Link>
      </div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Audit Events{run ? ` — ${run.period}` : ''}</h2>
        <button onClick={load} className="text-sm text-brand-600 hover:text-brand-700">Refresh</button>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-4 text-sm flex justify-between items-center">
          <span>{loadError}</span>
          <button onClick={load} className="text-red-700 font-medium hover:underline ml-4 whitespace-nowrap">Retry</button>
        </div>
      )}

      <p className="text-xs text-gray-500 mb-4">
        Immutable, append-only audit trail for this provision run (tenant-scoped).{loading ? ' Loading...' : ''}
      </p>

      <AuditTrailList events={events} />
    </div>
  );
}
