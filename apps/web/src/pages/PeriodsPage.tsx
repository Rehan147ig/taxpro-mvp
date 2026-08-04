import React, { useEffect, useState } from 'react';
import { periods as periodsApi, provision } from '../api/client';

export default function PeriodsPage() {
  const [groups, setGroups] = useState<any[]>([]);
  const [accounting, setAccounting] = useState<any[]>([]);
  const [tax, setTax] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ entityId: '', name: '', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, a, t, e] = await Promise.all([
        periodsApi.groups(),
        periodsApi.accounting(),
        periodsApi.tax(),
        provision.entities(),
      ]);
      setGroups(g);
      setAccounting(a);
      setTax(t);
      setEntities(e);
    } catch (err: any) {
      setError(err.message || 'Failed to load periods');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createTax = async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await periodsApi.createTax({
        entityId: form.entityId || entities[0]?.id,
        accountingPeriodId: accounting[0]?.id,
        startDate: form.startDate,
        endDate: form.endDate,
        status: form.status,
      });
      setCreated(created);
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create tax period');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex justify-between items-center pb-2 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-serif font-semibold text-[#0A192F] tracking-tight">Accounting & Tax Periods</h2>
          <p className="text-xs text-gray-500 mt-1">
            Entity groups, accounting periods and corporation-tax periods (CTA 2010 s.10) — non-standard durations are flagged for review
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs text-[#0A192F] font-semibold hover:underline bg-white border border-gray-200 px-3 py-1.5 rounded-button shadow-sm">Refresh</button>
          <button onClick={() => setShowCreate(!showCreate)} className="text-xs text-white font-semibold bg-[#0A192F] px-3 py-1.5 rounded-button shadow-sm">Create Tax Period</button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-card p-4 text-xs font-medium">{error}</div>}
      {created && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-card p-4 text-xs font-medium">
          Tax period created for {created.entityId?.slice(0, 8)}… — {created.durationMonths} months ({created.isStandardDuration ? 'standard' : 'NON-STANDARD'}) status: {created.status}
        </div>
      )}

      {showCreate && (
        <div className="bg-white rounded-card border border-gray-200 p-4 shadow-sm space-y-3">
          <h3 className="text-sm font-serif font-semibold text-[#0A192F]">New tax period</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <label className="text-xs text-gray-600">
              Entity
              <select value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded-button px-2 py-1.5 text-xs bg-white">
                {entities.map((en: any) => <option key={en.id} value={en.id}>{en.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-600">
              Start
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded-button px-2 py-1.5 text-xs bg-white" />
            </label>
            <label className="text-xs text-gray-600">
              End
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded-button px-2 py-1.5 text-xs bg-white" />
            </label>
            <label className="text-xs text-gray-600">
              Status
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="mt-1 w-full border border-gray-300 rounded-button px-2 py-1.5 text-xs bg-white">
                <option value="open">open</option>
                <option value="draft">draft</option>
                <option value="closed">closed</option>
              </select>
            </label>
            <div className="flex items-end">
              <button onClick={createTax} disabled={creating}
                className="text-xs text-white font-semibold bg-[#0A192F] px-3 py-1.5 rounded-button disabled:opacity-50">
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && <p className="text-xs text-gray-500">Loading periods…</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <h3 className="text-base font-serif font-semibold text-[#0A192F] mb-3 tracking-tight">Entity Groups</h3>
          <div className="bg-white rounded-card border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-[#F8F9FA] border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Name</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {groups.length === 0 && <tr><td colSpan={2} className="px-3 py-4 text-gray-400 text-center">No groups</td></tr>}
                {groups.map((g: any) => (
                  <tr key={g.id}>
                    <td className="px-3 py-2.5 font-medium text-[#0A192F]">{g.name}</td>
                    <td className="px-3 py-2.5 text-gray-500">{g.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-base font-serif font-semibold text-[#0A192F] mb-3 tracking-tight">Accounting Periods</h3>
          <div className="bg-white rounded-card border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-[#F8F9FA] border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Name</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Dates</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounting.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-gray-400 text-center">No accounting periods</td></tr>}
                {accounting.map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2.5 font-medium text-[#0A192F]">{p.name}</td>
                    <td className="px-3 py-2.5 text-gray-500 font-mono text-[11px]">{p.startDate} → {p.endDate}</td>
                    <td className="px-3 py-2.5"><span className="px-1.5 py-0.5 rounded-button text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-base font-serif font-semibold text-[#0A192F] mb-3 tracking-tight">Tax Periods (UK)</h3>
          <div className="bg-white rounded-card border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-xs">
              <thead className="bg-[#F8F9FA] border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Dates</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Months</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tax.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-gray-400 text-center">No tax periods</td></tr>}
                {tax.map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2.5 font-medium text-[#0A192F] font-mono text-[11px]">{p.startDate} → {p.endDate}</td>
                    <td className="px-3 py-2.5 text-gray-600">{p.durationMonths} {p.isStandardDuration ? '' : '(non-standard)'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded-button text-[10px] font-semibold border ${
                        p.status === 'needs_review'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : p.status === 'open'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-gray-100 text-gray-600 border-gray-200'
                      }`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
