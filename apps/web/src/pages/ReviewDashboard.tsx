import React, { useEffect, useState } from 'react';
import { provision as provApi } from '../api/client';

interface RunSummary {
  run: {
    id: string;
    period: string;
    status: string;
    mode: string;
    approvalStatus: string;
    exceptionSummary: string | null;
    createdAt: string;
    finalizedAt: string | null;
  };
  openItems: Array<{
    id: string;
    itemType: string;
    severity: string;
    status: string;
    title: string;
    description: string | null;
    accountId: string | null;
    sourceRef: string | null;
    confidenceScore: number | null;
    createdAt: string;
  }>;
}

export default function ReviewDashboard() {
  const [queue, setQueue] = useState<RunSummary[]>([]);
  const [allRuns, setAllRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedRunItems, setSelectedRunItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [evePrompt, setEvePrompt] = useState('');
  const [eveAnswer, setEveAnswer] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [q, runs] = await Promise.all([
        provApi.reviewQueue(),
        provApi.runs(),
      ]);
      setQueue(q);
      setAllRuns(runs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const selectRun = async (runId: string) => {
    setSelectedRun(runId);
    try {
      const items = await provApi.runReviewItems(runId);
      setSelectedRunItems(items);
    } catch {
      setSelectedRunItems([]);
    }
  };

  const resolveItem = async (itemId: string, resolution: string) => {
    if (!selectedRun) return;
    setActionLoading(itemId);
    try {
      await provApi.resolveItem(selectedRun, itemId, { resolution });
      const items = await provApi.runReviewItems(selectedRun);
      setSelectedRunItems(items);
      load(); // refresh queue
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const bulkResolve = async (resolution: string) => {
    if (!selectedRun) return;
    setActionLoading('bulk');
    try {
      await provApi.bulkResolve(selectedRun, { resolution });
      const items = await provApi.runReviewItems(selectedRun);
      setSelectedRunItems(items);
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const finalizeRun = async () => {
    if (!selectedRun) return;
    setActionLoading('finalize');
    try {
      await provApi.finalize(selectedRun);
      setSelectedRun(null);
      setSelectedRunItems([]);
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const askEve = async () => {
    if (!evePrompt.trim()) return;
    setEveAnswer('Thinking...');
    try {
      const res = await provApi.eveAsk(evePrompt);
      setEveAnswer(res.answer + (res.suggestedAction ? `\n\nSuggested action: ${res.suggestedAction}` : ''));
    } catch {
      setEveAnswer('Eve is currently unavailable. Try again later.');
    }
  };

  const getSeverityColor = (s: string) => {
    switch (s) {
      case 'high': return 'bg-red-100 text-red-700';
      case 'medium': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-blue-100 text-blue-700';
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      needs_review: 'bg-yellow-100 text-yellow-700',
      calculated: 'bg-blue-100 text-blue-700',
      workpapers_generated: 'bg-green-100 text-green-700',
      finalized: 'bg-gray-100 text-gray-700',
      failed: 'bg-red-100 text-red-700',
    };
    return colors[status] ?? 'bg-gray-100 text-gray-500';
  };

  if (loading) {
    return <p className="text-gray-500">Loading review queue...</p>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Review Dashboard</h2>
        <button onClick={load} className="text-sm text-brand-600 hover:text-brand-700">
          Refresh
        </button>
      </div>

      {/* Queue summary + all runs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Queue */}
        <div>
          <h3 className="font-semibold mb-3">
            Needs Review
            {queue.length > 0 && <span className="ml-2 text-sm text-yellow-600">({queue.length} run{queue.length > 1 ? 's' : ''})</span>}
          </h3>

          {queue.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
              <p className="text-gray-500 text-sm">No runs awaiting review</p>
              <p className="text-xs text-gray-400 mt-1">Run a provision with unmapped or low-confidence accounts to populate the queue</p>
            </div>
          ) : (
            <div className="space-y-3">
              {queue.map(({ run, openItems }) => (
                <button
                  key={run.id}
                  onClick={() => selectRun(run.id)}
                  className={`w-full text-left bg-white rounded-xl border p-4 hover:border-brand-300 transition ${
                    selectedRun === run.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-medium">{run.period}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${getStatusBadge(run.status)}`}>
                      {run.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {openItems.length} open item{openItems.length > 1 ? 's' : ''} · {run.mode} mode
                  </p>
                  {run.exceptionSummary && (
                    <p className="text-xs text-red-600 mt-1">{run.exceptionSummary}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {openItems.slice(0, 3).map((item) => (
                      <span key={item.id} className={`px-1.5 py-0.5 rounded text-xs ${getSeverityColor(item.severity)}`}>
                        {item.itemType.replace(/_/g, ' ')}
                      </span>
                    ))}
                    {openItems.length > 3 && (
                      <span className="text-xs text-gray-400">+{openItems.length - 3} more</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Recent runs */}
          <h3 className="font-semibold mt-6 mb-3">All Runs</h3>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Period</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Mode</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">Created</th>
                </tr>
              </thead>
              <tbody>
                {allRuns.map((r: any) => (
                  <tr
                    key={r.id}
                    onClick={() => selectRun(r.id)}
                    className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${
                      selectedRun === r.id ? 'bg-brand-50' : ''
                    }`}
                  >
                    <td className="px-3 py-2">{r.period}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${getStatusBadge(r.status)}`}>
                        {r.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{r.mode}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Selected run details */}
        <div>
          {selectedRun ? (
            <div>
              <h3 className="font-semibold mb-3">Review Items</h3>
              {selectedRunItems.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
                  <p className="text-gray-500 text-sm">No review items for this run</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedRunItems.map((item: any) => (
                    <div key={item.id} className={`bg-white rounded-xl border p-4 ${
                      item.status === 'resolved' ? 'border-green-200 bg-green-50' :
                      item.status === 'rejected' ? 'border-red-200 bg-red-50' :
                      'border-gray-200'
                    }`}>
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${getSeverityColor(item.severity)}`}>
                            {item.severity}
                          </span>
                          <span className="text-xs text-gray-400">{item.itemType.replace(/_/g, ' ')}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          item.status === 'resolved' ? 'bg-green-100 text-green-700' :
                          item.status === 'rejected' ? 'bg-red-100 text-red-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                      <p className="font-medium text-sm">{item.title}</p>
                      {item.description && <p className="text-xs text-gray-500 mt-1">{item.description}</p>}
                      {item.confidenceScore != null && (
                        <p className="text-xs mt-1">
                          Confidence: <span className={item.confidenceScore >= 75 ? 'text-green-600' : 'text-yellow-600'}>{item.confidenceScore}%</span>
                        </p>
                      )}
                      {item.resolutionNote && (
                        <p className="text-xs text-gray-400 italic mt-1">Note: {item.resolutionNote}</p>
                      )}
                      {item.status === 'open' && (
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => resolveItem(item.id, 'approved')}
                            disabled={actionLoading === item.id}
                            className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50"
                          >
                            {actionLoading === item.id ? '...' : 'Approve'}
                          </button>
                          <button
                            onClick={() => resolveItem(item.id, 'rejected')}
                            disabled={actionLoading === item.id}
                            className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => bulkResolve('approved')}
                  disabled={actionLoading === 'bulk'}
                  className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50"
                >
                  {actionLoading === 'bulk' ? '...' : 'Approve All'}
                </button>
                <button
                  onClick={finalizeRun}
                  disabled={actionLoading === 'finalize'}
                  className="text-sm bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-900 disabled:opacity-50"
                >
                  {actionLoading === 'finalize' ? '...' : 'Finalize'}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-500">Select a run to review items</p>
              <p className="text-xs text-gray-400 mt-1">Click a run from the left panel</p>
            </div>
          )}

          {/* Eve Assistant */}
          <div className="mt-6 bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold mb-2">Eve Assistant</h3>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={evePrompt}
                onChange={(e) => setEvePrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && askEve()}
                placeholder="Ask about a provision or next steps..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button onClick={askEve} className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700">
                Ask
              </button>
            </div>
            {eveAnswer && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">
                {eveAnswer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
