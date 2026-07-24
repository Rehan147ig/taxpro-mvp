import React, { useEffect, useState } from 'react';
import { mappings as mappingApi } from '../api/client';

interface TaxMapping {
  id: string;
  accountId: string;
  taxAccountType: string;
  bookTreatment: string;
  timingCategory: string | null;
  confidenceScore: number;
  suggestedByAi: boolean;
  aiExplanation: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function MappingPage() {
  const [mappings, setMappings] = useState<TaxMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [runLoading, setRunLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await mappingApi.list();
      setMappings(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRunAi = async () => {
    setRunLoading(true);
    setProgress('Enqueuing mapping job...');
    try {
      const { jobId } = await mappingApi.runAi();
      setProgress('Mapping in progress...');

      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const status = await mappingApi.status(jobId);
          if (status.progress?.mapped != null) {
            setProgress(`Mapped ${status.progress.mapped} of ${status.progress.total} accounts...`);
          }
          if (status.state === 'completed' || status.state === 'failed') {
            clearInterval(poll);
            setProgress(status.state === 'completed' ? 'Mapping complete' : 'Mapping failed');
            load();
            setRunLoading(false);
          }
        } catch {
          clearInterval(poll);
          setRunLoading(false);
        }
      }, 2000);
    } catch (err: any) {
      setProgress(null);
      alert(err.message);
      setRunLoading(false);
    }
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.8) return 'bg-green-100 text-green-700';
    if (score >= 0.5) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Tax Account Mapping</h2>
        <div className="flex items-center gap-3">
          {progress && (
            <span className="text-sm text-gray-500">{progress}</span>
          )}
          <button
            onClick={handleRunAi}
            disabled={runLoading}
            className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {runLoading ? 'Running...' : 'Run AI Mapping'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading mappings...</p>
      ) : mappings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500 mb-2">No mappings yet</p>
          <p className="text-sm text-gray-400">Connect NetSuite and sync data first, then run AI mapping</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Account ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Tax Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Treatment</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Timing</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Confidence</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Source</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{m.accountId.slice(0, 8)}...</td>
                  <td className="px-4 py-3">{m.taxAccountType.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      m.bookTreatment === 'permanent' ? 'bg-purple-100 text-purple-700' :
                      m.bookTreatment === 'temporary' ? 'bg-orange-100 text-orange-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {m.bookTreatment}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{m.timingCategory ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${getConfidenceColor(m.confidenceScore)}`}>
                      {Math.round(m.confidenceScore * 100)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {m.suggestedByAi ? 'AI' : 'Manual'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
