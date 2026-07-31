import React, { useEffect, useState } from 'react';
import { provision, connections as connApi, mappings as mappingApi, apiClient } from '../api/client';

export default function Dashboard() {
  const [stats, setStats] = useState({ connections: 0, mappings: 0, provisions: 0 });
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
    ])
      .then(([conns, maps, provs]) => {
        setStats({ connections: conns, mappings: maps, provisions: provs });
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
          <li>Export audit-ready workpapers</li>
        </ol>
      </div>
    </div>
  );
}
