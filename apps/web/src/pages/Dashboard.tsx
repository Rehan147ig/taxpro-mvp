import React, { useEffect, useState } from 'react';
import { provision, connections as connApi, mappings as mappingApi } from '../api/client';

export default function Dashboard() {
  const [stats, setStats] = useState({ connections: 0, mappings: 0, provisions: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      connApi.list().then(c => c.length),
      mappingApi.list().then(m => m.length),
      provision.results().then(p => p.length),
    ])
      .then(([conns, maps, provs]) => {
        setStats({ connections: conns, mappings: maps, provisions: provs });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const cards = [
    { label: 'NetSuite Connections', value: stats.connections, color: 'bg-blue-500' },
    { label: 'Accounts Mapped', value: stats.mappings, color: 'bg-green-500' },
    { label: 'Provision Runs', value: stats.provisions, color: 'bg-purple-500' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

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
