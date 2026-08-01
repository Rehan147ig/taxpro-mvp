import React, { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { provision, connections as connApi, mappings as mappingApi, apiClient } from '../api/client';

export default function Dashboard() {
  const [stats, setStats] = useState({ connections: 0, mappings: 0, provisions: 0 });
  const [runStatus, setRunStatus] = useState({ needsReview: 0, awaitingApproval: 0, finalized: 0, locked: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  function loadStats() {
    setLoading(true);
    setLoadError(null);
    Promise.all([
      connApi.list().then(c => c.length),
      mappingApi.list().then(m => m.length),
      provision.results().then(p => p.length),
      provision.runs().then(runs => {
        const rs = { needsReview: 0, awaitingApproval: 0, finalized: 0, locked: 0, total: runs.length };
        for (const r of runs) {
          if (r.status === 'locked') rs.locked++;
          else if (r.approvalStatus === 'pending_partner_review') rs.awaitingApproval++;
          else if (r.status === 'needs_review' || r.status === 'calculated' || r.status === 'workpapers_generated') rs.needsReview++;
          if (r.status === 'finalized') rs.finalized++;
        }
        return rs;
      }),
    ])
      .then(([conns, maps, provs, rs]) => {
        setStats({ connections: conns, mappings: maps, provisions: provs });
        setRunStatus(rs);
      })
      .catch((err: any) => setLoadError(err.message || 'Failed to load dashboard data'))
      .finally(() => setLoading(false));
  }

  async function loadDemoData() {
    setSeeding(true);
    setSeedError(null);
    setSeedResult(null);
    try {
      const res = await apiClient<{ message: string; summary: { totalIncome: number; totalExpenses: number; pbt: number } }>('/demo/seed', { method: 'POST' });
      setSeedResult(`Loaded! PBT: $${res.summary.pbt.toLocaleString()}. ${res.message}`);
      loadStats();
    } catch (err: any) {
      setSeedError(err.message || 'Failed to load demo data');
    } finally {
      setSeeding(false);
    }
  }

  const cards = [
    { label: 'NetSuite Connections', value: stats.connections, color: 'bg-blue-500' },
    { label: 'Accounts Mapped', value: stats.mappings, color: 'bg-green-500' },
    { label: 'Provision Runs', value: stats.provisions, color: 'bg-purple-500' },
  ];

  const statusCards = [
    { label: 'Needs Review', value: runStatus.needsReview, to: '/review', badge: 'bg-yellow-100 text-yellow-700' },
    { label: 'Awaiting Partner Approval', value: runStatus.awaitingApproval, to: '/review', badge: 'bg-indigo-100 text-indigo-700' },
    { label: 'Finalized', value: runStatus.finalized, to: '/review', badge: 'bg-green-100 text-green-700' },
    { label: 'Locked', value: runStatus.locked, to: '/review', badge: 'bg-gray-800 text-gray-100' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <button
          onClick={loadDemoData}
          disabled={seeding}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
        >
          {seeding ? 'Loading demo data...' : 'Load Demo Data (Greggs plc)'}
        </button>
      </div>

      {seedResult && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-4 mb-6 text-sm">{seedResult}</div>
      )}
      {seedError && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-xl p-4 mb-6 text-sm">{seedError}</div>
      )}
      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm">{loadError}</div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-8">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-6">
            <div className={`w-3 h-3 rounded-full ${card.color} mb-3`} />
            <p className="text-2xl font-bold">{loading ? '...' : card.value}</p>
            <p className="text-sm text-gray-500">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {statusCards.map((card) => (
          <Link
            key={card.label}
            to={card.to}
            className="bg-white rounded-xl border border-gray-200 p-4 hover:border-brand-300 transition"
          >
            <p className={`text-lg font-bold ${card.badge.split(' ')[1]}`}>{loading ? '...' : card.value}</p>
            <p className="text-xs text-gray-500">{card.label}</p>
          </Link>
        ))}
      </div>

      {runStatus.total === 0 && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8 text-center">
          <p className="text-sm text-gray-500 mb-2">No provision runs yet.</p>
          <Link to="/provision" className="text-sm text-brand-600 hover:underline font-medium">Run your first provision →</Link>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold mb-4">Getting Started</h3>
        <ol className="list-decimal list-inside text-sm text-gray-600 space-y-2">
          <li className={stats.connections > 0 ? 'line-through text-green-600' : ''}>
            Connect your NetSuite account
          </li>
          <li className={stats.mappings > 0 ? 'line-through text-green-600' : ''}>
            Run AI mapping to classify your accounts
          </li>
          <li className={stats.provisions > 0 ? 'line-through text-green-600' : ''}>
            Run provision calculation
          </li>
          <li className={runStatus.locked > 0 ? 'line-through text-green-600' : ''}>
            Review, approve, lock and export audit-ready workpapers
          </li>
        </ol>
      </div>
    </div>
  );
}
