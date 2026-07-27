import React, { useEffect, useState } from 'react';
import { provision as provApi } from '../api/client';
import { webProvisionRunCounter } from '../observability';

export default function ProvisionPage() {
  const [period, setPeriod] = useState('2024-01-01');
  const [endPeriod, setEndPeriod] = useState('');
  const [entityId, setEntityId] = useState('');
  const [entities, setEntities] = useState<{ id: string; name: string; type: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<'workpaper' | 'package' | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [entitiesError, setEntitiesError] = useState<string | null>(null);

  useEffect(() => {
    provApi.entities().then(setEntities).catch((err: any) => setEntitiesError(err.message || 'Failed to load entities'));
  }, []);

  const handleRun = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await provApi.run({ period, endPeriod: endPeriod || undefined, entityId: entityId || undefined });
      setResult(data);
      webProvisionRunCounter.add(1, { outcome: 'success' });
    } catch (err: any) {
      setError(err.message);
      webProvisionRunCounter.add(1, { outcome: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);

  const handleExport = async (type: 'workpaper' | 'package') => {
    if (!result?.id) return;
    setExporting(type);
    try {
      const blob = type === 'package' ? await provApi.exportPackage(result.id) : await provApi.exportResult(result.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = type === 'package'
        ? `taxpro-package-${period}.zip`
        : `taxpro-provision-${period}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Tax Provision</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="">All Entities</option>
            {entities.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          {entitiesError && <span className="text-red-500 text-xs">{entitiesError}</span>}
          <input
            type="month"
            value={period.slice(0, 7)}
            onChange={(e) => setPeriod(e.target.value + '-01')}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="month"
            value={endPeriod ? endPeriod.slice(0, 7) : ''}
            onChange={(e) => setEndPeriod(e.target.value ? e.target.value + '-01' : '')}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            placeholder="End period"
          />
          <button
            onClick={handleRun}
            disabled={loading}
            className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Calculating...' : 'Run Provision'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="flex justify-end gap-2">
            <button
              onClick={() => handleExport('workpaper')}
              disabled={exporting !== null}
              className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {exporting === 'workpaper' ? 'Exporting...' : 'Export Workpaper (.xlsx)'}
            </button>
            <button
              onClick={() => handleExport('package')}
              disabled={exporting !== null}
              className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {exporting === 'package' ? 'Exporting...' : 'Export Package (.zip)'}
            </button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase mb-1">Book Income</p>
              <p className="text-xl font-bold">{fmt(result.summary.bookIncome)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase mb-1">Total Tax Expense</p>
              <p className="text-xl font-bold">{fmt(result.summary.totalTaxExpense)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase mb-1">Effective Tax Rate</p>
              <p className="text-xl font-bold">{(result.summary.effectiveTaxRate * 100).toFixed(2)}%</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase mb-1">Tax Payable</p>
              <p className="text-xl font-bold">{fmt(result.summary.taxPayable)}</p>
            </div>
          </div>

          {/* Current Tax Details */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold mb-4">Current Tax Calculation</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Book Income:</span> {fmt(result.currentTax.bookIncome)}</div>
              <div><span className="text-gray-500">Permanent Adjustments:</span> {fmt(result.currentTax.totalPermanentAdjustments)}</div>
              <div><span className="text-gray-500">Taxable Income:</span> {fmt(result.currentTax.taxableIncome)}</div>
              <div><span className="text-gray-500">Federal Tax:</span> {fmt(result.currentTax.federalTax)}</div>
              <div><span className="text-gray-500">State Tax:</span> {fmt(result.currentTax.stateTax)}</div>
              <div><span className="text-gray-500">Tax Payable:</span> {fmt(result.currentTax.taxPayable)}</div>
            </div>
          </div>

          {/* Deferred Tax */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold mb-4">Deferred Tax</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Opening DTA:</span> {fmt(result.deferredTax.totalOpeningDTA)}</div>
              <div><span className="text-gray-500">Opening DTL:</span> {fmt(result.deferredTax.totalOpeningDTL)}</div>
              <div><span className="text-gray-500">Closing DTA:</span> {fmt(result.deferredTax.totalClosingDTA)}</div>
              <div><span className="text-gray-500">Closing DTL:</span> {fmt(result.deferredTax.totalClosingDTL)}</div>
              <div className="col-span-2">
                <span className="text-gray-500">Net Deferred Expense:</span>{' '}
                <span className={result.deferredTax.netDeferredTaxExpense > 0 ? 'text-red-600' : 'text-green-600'}>
                  {fmt(result.deferredTax.netDeferredTaxExpense)}
                </span>
              </div>
            </div>
          </div>

          {/* ETR Reconciliation */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold mb-4">ETR Reconciliation</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-medium text-gray-500">Item</th>
                  <th className="text-right py-2 font-medium text-gray-500">Amount</th>
                  <th className="text-right py-2 font-medium text-gray-500">Rate Impact</th>
                </tr>
              </thead>
              <tbody>
                {result.etr.lines.map((line: any, i: number) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2">{line.description}</td>
                    <td className="text-right py-2">{fmt(line.taxImpact)}</td>
                    <td className="text-right py-2">{(line.rateImpact * 100).toFixed(2)}%</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2">Effective Rate</td>
                  <td className="text-right py-2">{fmt(result.etr.totalTaxExpense)}</td>
                  <td className="text-right py-2">{(result.etr.effectiveTaxRate * 100).toFixed(2)}%</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Journal Entries */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold mb-4">Proposed Journal Entries</h3>
            {result.journalEntries.map((je: any, i: number) => (
              <div key={i} className="mb-4">
                <p className="text-sm font-medium text-gray-600 uppercase mb-2">
                  {je.type.replace(/_/g, ' ')} — Period: {je.period}
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 font-medium text-gray-500">Account</th>
                      <th className="text-right py-2 font-medium text-gray-500">Debit</th>
                      <th className="text-right py-2 font-medium text-gray-500">Credit</th>
                      <th className="text-left py-2 font-medium text-gray-500">Memo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {je.lines.map((line: any, j: number) => (
                      <tr key={j} className="border-b border-gray-100">
                        <td className="py-2 font-mono text-xs">{line.accountId}</td>
                        <td className="text-right py-2">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
                        <td className="text-right py-2">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
                        <td className="py-2 text-gray-500">{line.memo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
