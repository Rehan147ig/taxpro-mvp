import React, { useEffect, useState } from 'react';
import { documents as docsApi } from '../api/client';

const DOCUMENT_TYPES = [
  'trial_balance',
  'prior_year_tax_computation',
  'ct600',
  'workpaper',
  'fixed_asset_schedule',
  'loss_schedule',
  'supporting_pdf',
  'other',
];

export default function DocumentsPage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState('trial_balance');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setDocs(await docsApi.list());
    } catch (err: any) {
      setError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await docsApi.upload(file, selectedType);
      await load();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const onDownload = async (id: string, filename: string) => {
    try {
      const blob = await docsApi.download(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Download failed');
    }
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex justify-between items-center pb-2 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-serif font-semibold text-[#0A192F] tracking-tight">Source Documents</h2>
          <p className="text-xs text-gray-500 mt-1">
            Versioned artefact store — original uploads are immutable; replacements create new versions with provenance (SHA-256, tenant-scoped)
          </p>
        </div>
        <button onClick={load} className="text-xs text-[#0A192F] font-semibold hover:underline bg-white border border-gray-200 px-3 py-1.5 rounded-button shadow-sm">Refresh</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-card p-4 text-xs font-medium">{error}</div>}

      <div className="bg-white rounded-card border border-gray-200 p-4 shadow-sm flex items-end gap-3">
        <label className="text-xs text-gray-600">
          Document type
          <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}
            className="mt-1 border border-gray-300 rounded-button px-2 py-1.5 text-xs bg-white">
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-xs text-[#0A192F] font-semibold bg-white border border-gray-300 rounded-button px-3 py-1.5 cursor-pointer hover:bg-gray-50">
          {uploading ? 'Uploading…' : `Upload ${selectedType}`}
          <input type="file" className="hidden" onChange={onUpload} disabled={uploading} />
        </label>
      </div>

      {loading && <p className="text-xs text-gray-500">Loading documents…</p>}

      <div className="bg-white rounded-card border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-xs">
          <thead className="bg-[#F8F9FA] border-b border-gray-200">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Filename</th>
              <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Type</th>
              <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Version</th>
              <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">SHA-256</th>
              <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Provenance</th>
              <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Size</th>
              <th className="text-left px-3 py-2.5 font-semibold text-[#0A192F]">Uploaded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {docs.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-3 py-4 text-gray-400 text-center">No documents yet — upload a trial balance or supporting PDF.</td></tr>
            )}
            {docs.map((d: any) => (
              <tr key={d.id} className="hover:bg-[#F8F9FA]">
                <td className="px-3 py-2.5 font-medium text-[#0A192F]">
                  <span className="cursor-pointer hover:underline" onClick={() => onDownload(d.id, d.filename)}>{d.filename}</span>
                  {d.isCurrent && <span className="ml-2 px-1.5 py-0.5 rounded-button text-[10px] font-semibold bg-[#E8F7F0] text-[#10B981] border border-[#10B981]/30">current</span>}
                  {!d.isCurrent && <span className="ml-2 px-1.5 py-0.5 rounded-button text-[10px] font-semibold bg-gray-100 text-gray-500 border border-gray-200">superseded</span>}
                </td>
                <td className="px-3 py-2.5 text-gray-600">{d.documentType}</td>
                <td className="px-3 py-2.5 text-gray-600 font-mono text-[11px]">v{d.version}</td>
                <td className="px-3 py-2.5 text-gray-500 font-mono text-[11px]">{d.sha256?.slice(0, 12)}…</td>
                <td className="px-3 py-2.5 text-gray-500">{d.provenance}</td>
                <td className="px-3 py-2.5 text-gray-500">{(d.sizeBytes / 1024).toFixed(1)} KB</td>
                <td className="px-3 py-2.5 text-gray-500 font-mono text-[11px]">{new Date(d.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
