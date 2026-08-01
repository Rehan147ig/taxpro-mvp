import React, { useEffect, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { provision as provApi } from '../api/client';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ExportPackagePage() {
  const { runId } = useParams({ from: '/runs/$runId/export' });
  const [run, setRun] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ct600, setCt600] = useState<any | null>(null);
  const [rdClaim, setRdClaim] = useState<any | null>(null);
  const [mtdFlags, setMtdFlags] = useState({ agentAuthorised: false, signedUp: false, softwareConnected: false });
  const [mtdReport, setMtdReport] = useState<any | null>(null);
  const [ctoXml, setCtoXml] = useState<string | null>(null);

  const resultId = run?.resultId ?? null;

  useEffect(() => {
    provApi.runs().then((runs: any[]) => setRun(runs.find((r: any) => r.id === runId) ?? null)).catch(() => {});
  }, [runId]);

  const runDownload = async (name: string, fn: () => Promise<Blob>, filename: string) => {
    setBusy(name);
    setError(null);
    try {
      downloadBlob(await fn(), filename);
    } catch (err: any) {
      setError(err.message || `${name} failed`);
    } finally {
      setBusy(null);
    }
  };

  const loadCt600 = async () => {
    setBusy('ct600');
    setError(null);
    try {
      setCt600(await provApi.ct600(resultId));
    } catch (err: any) {
      setError(err.message || 'CT600 load failed');
    } finally {
      setBusy(null);
    }
  };

  const loadRdClaim = async () => {
    setBusy('rd');
    setError(null);
    try {
      setRdClaim(await provApi.rdClaim(resultId));
    } catch (err: any) {
      setError(err.message || 'RD claim load failed');
    } finally {
      setBusy(null);
    }
  };

  const loadMtd = async () => {
    setBusy('mtd');
    setError(null);
    try {
      setMtdReport(await provApi.mtdReadiness(resultId, mtdFlags));
    } catch (err: any) {
      setError(err.message || 'MTD readiness load failed');
    } finally {
      setBusy(null);
    }
  };

  const loadCtoXml = async () => {
    setBusy('cto');
    setError(null);
    try {
      setCtoXml(await provApi.ctoXml(resultId));
    } catch (err: any) {
      setError(err.message || 'CTO XML load failed');
    } finally {
      setBusy(null);
    }
  };

  const period = run?.period ?? 'run';

  return (
    <div>
      <div className="mb-2">
        <Link to="/runs/$runId" params={{ runId }} className="text-xs text-gray-500 hover:text-gray-700">← Back to Run Detail</Link>
      </div>
      <h2 className="text-2xl font-bold mb-1">Export Package{run ? ` — ${period}` : ''}</h2>
      <p className="text-xs text-gray-500 mb-4">
        Byte-reproducible, audit-ready compliance package. Outputs are <span className="font-medium text-yellow-700">validation-ready, not filing-ready</span> — validate with HMRC/Companies House tooling before any submission.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm">{error}</div>
      )}

      {!resultId && <p className="text-gray-500 text-sm mb-4">Loading run...</p>}

      {resultId && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold mb-1">Final Package</h3>
            <p className="text-xs text-gray-500 mb-3">Zip containing: Excel workpaper, audit trail CSV, review items, AI traces, approval trail, assumptions, manifest.json (SHA-256 per file).</p>
            <div className="flex gap-2">
              <button
                onClick={() => runDownload('package', () => provApi.exportPackage(resultId), `taxpro-package-${period}.zip`)}
                disabled={busy !== null}
                className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {busy === 'package' ? 'Building...' : 'Download Package (.zip)'}
              </button>
              <button
                onClick={() => runDownload('workpaper', () => provApi.exportResult(resultId), `taxpro-provision-${period}.xlsx`)}
                disabled={busy !== null}
                className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                {busy === 'workpaper' ? 'Exporting...' : 'Workpaper (.xlsx)'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">CT600 (UK)</h3>
                <p className="text-xs text-gray-500">CT600-ready figures — box layout 2016+, consistency-flagged.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={loadCt600} disabled={busy !== null} className="text-sm text-brand-600 hover:underline disabled:opacity-50">{busy === 'ct600' ? 'Loading...' : 'View JSON'}</button>
                <button
                  onClick={() => runDownload('ct600csv', async () => new Blob([await provApi.ct600(resultId, 'csv')], { type: 'text/csv' }), `taxpro-ct600-${period}.csv`)}
                  disabled={busy !== null}
                  className="text-sm text-brand-600 hover:underline disabled:opacity-50"
                >
                  Download CSV
                </button>
              </div>
            </div>
            {ct600 && (
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs overflow-auto max-h-96">{JSON.stringify(ct600, null, 2)}</pre>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">R&D Claim</h3>
                <p className="text-xs text-gray-500">RDEC/surrender package from credit-miner output.</p>
              </div>
              <button onClick={loadRdClaim} disabled={busy !== null} className="text-sm text-brand-600 hover:underline disabled:opacity-50">{busy === 'rd' ? 'Loading...' : 'View'}</button>
            </div>
            {rdClaim?.notice && <p className="text-xs text-yellow-700 mb-2">{rdClaim.notice}</p>}
            {rdClaim && (
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs overflow-auto max-h-96">{JSON.stringify(rdClaim, null, 2)}</pre>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">MTD for Corporation Tax — Readiness</h3>
                <p className="text-xs text-gray-500">Gate checklist. CT MTD API is still private beta — today's live channel is CTO GovTalk XML.</p>
              </div>
              <button onClick={loadMtd} disabled={busy !== null} className="text-sm text-brand-600 hover:underline disabled:opacity-50">{busy === 'mtd' ? 'Checking...' : 'Check'}</button>
            </div>
            <div className="flex gap-4 mb-3 text-xs text-gray-600">
              <label className="flex items-center gap-1"><input type="checkbox" checked={mtdFlags.agentAuthorised} onChange={(e) => setMtdFlags({ ...mtdFlags, agentAuthorised: e.target.checked })} /> Agent has authority</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={mtdFlags.signedUp} onChange={(e) => setMtdFlags({ ...mtdFlags, signedUp: e.target.checked })} /> Signed up for MTD</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={mtdFlags.softwareConnected} onChange={(e) => setMtdFlags({ ...mtdFlags, softwareConnected: e.target.checked })} /> Software connected</label>
            </div>
            {mtdReport && (
              <div className="space-y-2">
                <div className={`text-sm font-medium ${mtdReport.eligible ? 'text-green-700' : 'text-red-700'}`}>
                  {mtdReport.eligible ? 'Eligible — readiness gate met' : `Not eligible: ${mtdReport.missing.join('; ')}`}
                </div>
                <div className="space-y-1">
                  {mtdReport.gate.map((g: any) => (
                    <div key={g.requirement} className="flex items-center gap-2 text-xs">
                      <span className={`w-2 h-2 rounded-full ${g.met ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span>{g.requirement}</span>
                      <span className="text-gray-400">({g.detail})</span>
                    </div>
                  ))}
                </div>
                <ul className="text-xs text-gray-500 list-disc list-inside">
                  {mtdReport.nextSteps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">CTO GovTalk XML (live filing channel)</h3>
                <p className="text-xs text-gray-500">CT600 XML for Corporation Tax Online submission via agent software.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={loadCtoXml} disabled={busy !== null} className="text-sm text-brand-600 hover:underline disabled:opacity-50">{busy === 'cto' ? 'Loading...' : 'View XML'}</button>
                {ctoXml && (
                  <button
                    onClick={() => downloadBlob(new Blob([ctoXml], { type: 'application/xml' }), `taxpro-cto-${period}.xml`)}
                    className="text-sm text-brand-600 hover:underline"
                  >
                    Download
                  </button>
                )}
              </div>
            </div>
            {ctoXml && (
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs overflow-auto max-h-96">{ctoXml}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
