import React, { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { workbench } from '../api/client';
import { RunStatusBadge } from '../components/RunStatusBadge';

const SAMPLE_CSV = [
  '4000,Sales revenue,Income,Income,-4800000',
  '5000,Salaries and wages,Expense,Expense,1600000',
  '5100,Office rent,Expense,Expense,240000',
  '5200,Book depreciation expense,Expense,Fixed Asset,520000',
  '5300,Bad debt reserve,Expense,Expense,120000',
  '5400,Research and development,Expense,Expense,650000',
  '5500,Non-deductible entertaining,Expense,Expense,85000',
  '5600,Penalties and fines,Expense,Expense,25000',
  '5700,Software subscription costs,Expense,Expense,95000',
  '5800,Cloud infrastructure hosting,Expense,Expense,180000',
].join('\n');

function idempotencyKey(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseCsv(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [externalId, name, type, detailType, balance] = line.split(',').map((s) => s.trim());
      return {
        externalId,
        name,
        type,
        detailType: detailType || undefined,
        balance: Number(balance),
      };
    })
    .filter((r) => r.externalId && r.name && !Number.isNaN(r.balance));
}

const fmt = (n: number | string | undefined) => {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).format(v);
};

export default function WorkbenchPage() {
  const [setup, setSetup] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [entityId, setEntityId] = useState('');
  const [accountingPeriodId, setAccountingPeriodId] = useState('');
  const [taxPeriodId, setTaxPeriodId] = useState('');
  const [sourceDocumentId, setSourceDocumentId] = useState('');

  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);
  const [blocked, setBlocked] = useState<any>(null);

  const [view, setView] = useState<any>(null);
  const [viewing, setViewing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const ukEntities = (setup?.entities ?? []).filter(
    (e: any) => e.taxJurisdiction && ['UK_FRS102', 'UK_FRS102_S29', 'UK'].includes(e.taxJurisdiction.trim()),
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await workbench.setup();
      setSetup(data);
      const uk = (data.entities ?? []).filter(
        (e: any) => e.taxJurisdiction && ['UK_FRS102', 'UK_FRS102_S29', 'UK'].includes(e.taxJurisdiction.trim()),
      );
      const standardPeriod = (data.taxPeriods ?? []).find((p: any) => p.isStandardDuration !== false)
        ?? (data.taxPeriods ?? [])[0];
      setEntityId((prev) => prev || uk[0]?.id || '');
      setAccountingPeriodId((prev) => prev || data.accountingPeriods[0]?.id || '');
      setTaxPeriodId((prev) => prev || standardPeriod?.id || '');
      setSourceDocumentId((prev) => prev || data.documents[0]?.id || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load workbench setup');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleImport = async () => {
    const rows = parseCsv(csv);
    if (rows.length === 0) {
      setError('No valid rows to import. Each line must be: externalId,name,type,detailType,balance');
      return;
    }
    if (!entityId || !accountingPeriodId || !taxPeriodId || !sourceDocumentId) {
      setError('Select an entity, accounting period, tax period and source document first.');
      return;
    }
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const res = await workbench.importTrialBalance({
        idempotencyKey: idempotencyKey('imp'),
        entityId,
        accountingPeriodId,
        taxPeriodId,
        sourceDocumentId,
        rows,
      });
      if (res.ok) {
        setImportResult(res.body);
      } else {
        setError(res.body.error || 'Import failed');
      }
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleRun = async () => {
    if (!entityId || !accountingPeriodId || !taxPeriodId || !sourceDocumentId) {
      setError('Select an entity, accounting period, tax period and source document first.');
      return;
    }
    setRunning(true);
    setError(null);
    setRunResult(null);
    setBlocked(null);
    try {
      const res = await workbench.run({
        idempotencyKey: idempotencyKey('run'),
        entityId,
        accountingPeriodId,
        taxPeriodId,
        sourceDocumentId,
      });
      if (res.ok) {
        setRunResult(res.body);
        load();
      } else if (res.body.blocked) {
        setBlocked(res.body);
      } else {
        setError(res.body.error || 'Calculation run failed');
      }
    } catch (err: any) {
      setError(err.message || 'Calculation run failed');
    } finally {
      setRunning(false);
    }
  };

  const handleRecalculate = async () => {
    const runId = runResult?.result?.runId;
    if (!runId) return;
    setRecalculating(true);
    setError(null);
    try {
      const res = await workbench.recalculate(runId, idempotencyKey('recalc'));
      if (res.ok) {
        setRunResult(res.body);
        load();
      } else {
        setError(res.body.error || 'Recalculation failed');
      }
    } catch (err: any) {
      setError(err.message || 'Recalculation failed');
    } finally {
      setRecalculating(false);
    }
  };

  const openView = async (id: string) => {
    setViewing(true);
    setError(null);
    setView(null);
    try {
      setView(await workbench.view(id));
    } catch (err: any) {
      setError(err.message || 'Failed to load run details');
    } finally {
      setViewing(false);
    }
  };

  const selectCls = 'px-3 py-2 border border-gray-300 rounded-button text-xs bg-white text-[#0A192F] focus:ring-2 focus:ring-[#0A192F]';

  return (
    <div className="space-y-6 font-sans">
      <div className="flex justify-between items-center pb-2 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-serif font-semibold text-[#0A192F] tracking-tight">UK Tax-Close Workbench</h2>
          <p className="text-xs text-gray-500 mt-1">
            Deterministic, versioned close: import trial balance → gated calculation → review → approval. Every run is
            idempotent and linked to its evidence.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs text-[#0A192F] font-semibold hover:underline bg-white border border-gray-200 px-3 py-1.5 rounded-button shadow-sm">Refresh</button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-card p-4 text-xs font-medium">{error}</div>}
      {loading && <p className="text-xs text-gray-500">Loading workbench setup…</p>}

      {setup && (
        <>
          <div className="bg-white rounded-card border border-gray-200 p-4 shadow-sm space-y-3">
            <h3 className="text-base font-serif font-semibold text-[#0A192F] tracking-tight">Close parameters</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="block">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">UK entity</span>
                <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={`${selectCls} w-full`}>
                  <option value="">Select entity…</option>
                  {ukEntities.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                {ukEntities.length === 0 && (
                  <span className="text-[10px] text-amber-700 block mt-1">No UK entities found. Create one under Periods &amp; Entities.</span>
                )}
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Accounting period</span>
                <select value={accountingPeriodId} onChange={(e) => setAccountingPeriodId(e.target.value)} className={`${selectCls} w-full`}>
                  <option value="">Select…</option>
                  {(setup.accountingPeriods ?? []).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.startDate} → {p.endDate})</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Tax period</span>
                <select value={taxPeriodId} onChange={(e) => setTaxPeriodId(e.target.value)} className={`${selectCls} w-full`}>
                  <option value="">Select…</option>
                  {(setup.taxPeriods ?? []).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.startDate} → {p.endDate}{p.isStandardDuration === false ? ' (non-standard)' : ''}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Source document</span>
                <select value={sourceDocumentId} onChange={(e) => setSourceDocumentId(e.target.value)} className={`${selectCls} w-full`}>
                  <option value="">Select…</option>
                  {(setup.documents ?? []).map((d: any) => (
                    <option key={d.id} value={d.id}>{d.filename} ({d.documentType})</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-card border border-gray-200 p-4 shadow-sm space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-base font-serif font-semibold text-[#0A192F] tracking-tight">1 · Import trial balance</h3>
                <span className="text-[10px] text-gray-400">idempotent, evidence-linked</span>
              </div>
              <p className="text-[11px] text-gray-500">
                Rows are upserted per external ID and linked to the selected source document. One line per account:
                <span className="font-mono"> externalId,name,type,detailType,balance</span>
              </p>
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                rows={10}
                spellCheck={false}
                className="w-full border border-gray-300 rounded-button p-2 text-[11px] font-mono text-[#0A192F] bg-white focus:ring-2 focus:ring-[#0A192F]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setCsv(SAMPLE_CSV)}
                  className="text-[10px] text-[#0A192F] font-semibold bg-white border border-gray-200 px-3 py-1.5 rounded-button shadow-sm"
                >
                  Sample chart
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="text-[10px] font-semibold bg-[#0A192F] text-white px-3 py-1.5 rounded-button disabled:opacity-50"
                >
                  {importing ? 'Importing…' : 'Import'}
                </button>
              </div>
              {importResult && (
                <div className="bg-[#E8F7F0] border border-[#10B981]/30 text-[#0B5C3C] rounded-card p-3 text-[11px] space-y-1">
                  <p className="font-semibold">
                    Import {importResult.replayed ? 'replayed from job ledger' : 'complete'} — {importResult.result?.rowsInserted ?? importResult.rowsInserted ?? 0} rows,{' '}
                    {importResult.result?.accountsCreated ?? importResult.accountsCreated ?? 0} accounts created
                  </p>
                  <p className="text-[10px] text-[#0B5C3C]/80">Period {importResult.result?.period ?? ''} · source {importResult.result?.source ?? ''}</p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-card border border-gray-200 p-4 shadow-sm space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-base font-serif font-semibold text-[#0A192F] tracking-tight">2 · Run calculation</h3>
                <span className="text-[10px] text-gray-400">gated, deterministic, versioned</span>
              </div>
              <p className="text-[11px] text-gray-500">
                Runs are blocked until evidence is linked, proposals are decided, and non-standard periods are reviewed.
                Identical inputs always produce the same result (same input &amp; mapping hashes).
              </p>
              <button
                onClick={handleRun}
                disabled={running}
                className="text-xs font-semibold bg-[#0A192F] text-white px-4 py-2 rounded-button disabled:opacity-50"
              >
                {running ? 'Calculating…' : 'Run Workbench Calculation'}
              </button>

              {blocked && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-card p-3 text-[11px] space-y-1">
                  <p className="font-semibold">Run blocked — {blocked.blockers?.length ?? 0} gate(s) open:</p>
                  {(blocked.blockers ?? []).map((b: any) => (
                    <p key={b.code} className="pl-2">· {b.code}: {b.message}</p>
                  ))}
                  <p className="text-[10px] text-red-600/80">Resolve the gates (approve proposals, link evidence, review non-standard periods) then retry.</p>
                </div>
              )}

              {runResult && runResult.result && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <RunStatusBadge status={runResult.result.status} />
                    {runResult.replayed && <span className="text-[10px] font-semibold text-gray-500">replayed from job ledger</span>}
                    <Link to="/runs/$runId" params={{ runId: runResult.result.runId }} className="text-[10px] text-[#0A192F] font-semibold hover:underline">
                      Open in Review →
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Current tax</span><div className="font-semibold text-[#0A192F]">{fmt(runResult.result.summary?.currentTaxExpense)}</div></div>
                    <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Deferred tax</span><div className="font-semibold text-[#0A192F]">{fmt(runResult.result.summary?.deferredTaxExpense)}</div></div>
                    <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Total tax expense</span><div className="font-semibold text-[#0A192F]">{fmt(runResult.result.summary?.totalTaxExpense)}</div></div>
                    <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Effective tax rate</span><div className="font-semibold text-[#0A192F]">{Number(runResult.result.summary?.effectiveTaxRate ?? 0).toFixed(1)}%</div></div>
                  </div>
                  <div className="text-[10px] font-mono text-gray-500 break-all">
                    input hash {runResult.result.inputDataHash} · mapping hash {runResult.result.mappingVersionHash}
                  </div>
                  {runResult.result.openReviewItems > 0 && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-card p-2">
                      {runResult.result.openReviewItems} review item(s) require attention before approval.
                    </p>
                  )}
                  <button
                    onClick={handleRecalculate}
                    disabled={recalculating}
                    className="text-[10px] text-[#0A192F] font-semibold bg-white border border-gray-200 px-3 py-1.5 rounded-button shadow-sm disabled:opacity-50"
                  >
                    {recalculating ? 'Recalculating…' : 'Recalculate (new version, never mutates)'}
                  </button>
                  {runResult.result.parentRunId && (
                    <p className="text-[10px] text-gray-400">Version of run {runResult.result.parentRunId.slice(0, 8)}…</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-card border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-base font-serif font-semibold text-[#0A192F] tracking-tight">Recent workbench runs</h3>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-[#F8F9FA] border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Period</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Status</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Approval</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Created</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {setup.recentRuns.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-4 text-gray-400 text-center">No runs yet. Run your first calculation above.</td></tr>
                )}
                {setup.recentRuns.map((r: any) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-[#0A192F]">{r.period}{r.endPeriod && r.endPeriod !== r.period ? ` → ${r.endPeriod}` : ''}</td>
                    <td className="px-3 py-2.5"><RunStatusBadge status={r.status} /></td>
                    <td className="px-3 py-2.5 text-gray-500">{r.approvalStatus}</td>
                    <td className="px-3 py-2.5 text-gray-500">{r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => openView(r.id)} disabled={viewing}
                        className="text-[10px] text-[#0A192F] font-semibold hover:underline disabled:opacity-50">
                        {viewing ? 'Loading…' : 'View run'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {view && (
            <div className="bg-white rounded-card border border-gray-200 p-4 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-base font-serif font-semibold text-[#0A192F] tracking-tight">Run detail</h3>
                <button onClick={() => setView(null)} className="text-xs text-[#0A192F] font-semibold hover:underline">Close</button>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <RunStatusBadge status={view.run.status} />
                <span className="text-[10px] font-mono text-gray-500">{view.run.id.slice(0, 8)}…</span>
                {view.approvalBlocked && (
                  <span className="text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-button px-2 py-0.5">
                    approval blocked
                  </span>
                )}
                {view.run.parentRunId && <span className="text-[10px] text-gray-400">version of {view.run.parentRunId.slice(0, 8)}…</span>}
                {view.childRuns?.length > 0 && (
                  <span className="text-[10px] text-gray-400">{view.childRuns.length} child version(s)</span>
                )}
                <Link to="/runs/$runId" params={{ runId: view.run.id }} className="text-[10px] text-[#0A192F] font-semibold hover:underline">
                  Open in Review →
                </Link>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-[11px]">
                <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Evidence</span><div className="font-semibold text-[#0A192F] truncate" title={view.evidence?.filename}>{view.evidence?.filename ?? 'none'}</div></div>
                <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Entity</span><div className="font-semibold text-[#0A192F]">{view.entity?.name ?? '—'}</div></div>
                <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Input hash</span><div className="font-mono text-[10px] text-[#0A192F] break-all">{view.run.inputDataHash ?? '—'}</div></div>
                <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Mapping hash</span><div className="font-mono text-[10px] text-[#0A192F] break-all">{view.run.mappingVersionHash ?? '—'}</div></div>
              </div>

              {view.run.assumptions && view.run.assumptions.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-[#0A192F] mb-1">Assumptions</h4>
                  <ul className="list-disc pl-5 text-[11px] text-gray-600 space-y-0.5">
                    {view.run.assumptions.map((a: string, i: number) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}

              {view.run.warnings && view.run.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-card p-3">
                  <h4 className="text-xs font-semibold text-amber-800 mb-1">Warnings</h4>
                  {(view.run.warnings ?? []).map((w: any, i: number) => (
                    <p key={i} className="text-[11px] text-amber-800"><span className="font-mono">{w.code}</span> — {w.message}</p>
                  ))}
                </div>
              )}

              {view.reviewItems && view.reviewItems.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-[#0A192F] mb-1">Review items</h4>
                  <table className="w-full text-[11px]">
                    <thead className="bg-[#F8F9FA] border-b border-gray-200">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-semibold text-[#0A192F]">Type</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-[#0A192F]">Severity</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-[#0A192F]">Status</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-[#0A192F]">Title</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {view.reviewItems.map((i: any) => (
                        <tr key={i.id}>
                          <td className="px-2 py-1.5 font-mono text-[10px] text-[#0A192F]">{i.itemType}</td>
                          <td className="px-2 py-1.5 text-gray-500">{i.severity}</td>
                          <td className="px-2 py-1.5"><span className={`px-1.5 py-0.5 rounded-button text-[10px] font-semibold border ${i.status === 'open' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-[#E8F7F0] text-[#10B981] border-[#10B981]/30'}`}>{i.status}</span></td>
                          <td className="px-2 py-1.5 text-gray-600">{i.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {view.result && (
                <div>
                  <h4 className="text-xs font-semibold text-[#0A192F] mb-1">Result summary</h4>
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-[11px]">
                    <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Book income</span><div className="font-semibold text-[#0A192F]">{fmt(view.result.bookIncome)}</div></div>
                    <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Current tax</span><div className="font-semibold text-[#0A192F]">{fmt(view.result.currentTaxExpense)}</div></div>
                    <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Deferred tax</span><div className="font-semibold text-[#0A192F]">{fmt(view.result.deferredTaxExpense)}</div></div>
                    <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Total</span><div className="font-semibold text-[#0A192F]">{fmt(view.result.totalTaxExpense)}</div></div>
                    <div className="bg-gray-50 rounded-card p-2"><span className="text-gray-500">Tax payable</span><div className="font-semibold text-[#0A192F]">{fmt(view.result.taxPayable)}</div></div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
