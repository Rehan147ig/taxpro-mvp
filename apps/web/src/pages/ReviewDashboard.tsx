import React, { useEffect, useState } from 'react';
import { provision as provApi, mappings as mappingApi } from '../api/client';
import AiFindingsPanel from '../components/AiFindingsPanel';

interface RunSummary {
  run: any;
  openItems: any[];
}

export default function ReviewDashboard() {
  const [queue, setQueue] = useState<RunSummary[]>([]);
  const [allRuns, setAllRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedRunDetails, setSelectedRunDetails] = useState<any | null>(null);
  const [selectedRunItems, setSelectedRunItems] = useState<any[]>([]);
  const [tbDetails, setTbDetails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  const [activeTab, setActiveTab] = useState<'queue' | 'tb'>('queue');
  const [evePrompt, setEvePrompt] = useState('');
  const [eveAnswer, setEveAnswer] = useState('');
  const [aiFindings, setAiFindings] = useState<{ pending: boolean; agents: any[] } | null>(null);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedRun || !aiFindings?.pending) return;
    const timer = setTimeout(async () => {
      try {
        setAiFindings(await provApi.aiFindings(selectedRun));
      } catch { /* retry on next poll cycle */ }
    }, 4000);
    return () => clearTimeout(timer);
  }, [selectedRun, aiFindings]);

  const load = async () => {
    setLoading(true);
    try {
      const [q, runs] = await Promise.all([
        provApi.reviewQueue(),
        provApi.runs(),
      ]);
      setQueue(q);
      setAllRuns(runs);
      if (selectedRun) {
        const runDetails = runs.find(r => r.id === selectedRun);
        setSelectedRunDetails(runDetails || null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const selectRun = async (runId: string) => {
    setSelectedRun(runId);
    setAiFindings(null);
    setTbDetails([]);
    
    const runDetails = allRuns.find(r => r.id === runId) || queue.find(q => q.run.id === runId)?.run;
    setSelectedRunDetails(runDetails || null);

    try {
      const items = await provApi.runReviewItems(runId);
      setSelectedRunItems(items);
    } catch {
      setSelectedRunItems([]);
    }
    try {
      const tb = await provApi.runTrialBalanceDetail(runId);
      setTbDetails(tb);
    } catch {
      setTbDetails([]);
    }
    try {
      setAiFindings(await provApi.aiFindings(runId));
    } catch {
      setAiFindings(null);
    }
  };

  const resolveItem = async (itemId: string, resolution: string) => {
    if (!selectedRun) return;
    setActionLoading(itemId);
    try {
      await provApi.resolveItem(selectedRun, itemId, { resolution });
      await selectRun(selectedRun);
      load();
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
      await selectRun(selectedRun);
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const submitForApproval = async () => {
    if (!selectedRun) return;
    setActionLoading('submit');
    try {
      await provApi.submitForApproval(selectedRun);
      await selectRun(selectedRun);
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const partnerApprove = async () => {
    if (!selectedRun) return;
    setActionLoading('approve');
    try {
      await provApi.partnerApprove(selectedRun);
      await selectRun(selectedRun);
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const lockRun = async () => {
    if (!selectedRun) return;
    setActionLoading('lock');
    try {
      await provApi.lockRun(selectedRun);
      await selectRun(selectedRun);
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const updateInlineMapping = async (accountId: string, field: string, value: string) => {
    // To update a mapping, we need the current taxAccountType and bookTreatment.
    const row = tbDetails.find(t => t.accountId === accountId);
    if (!row) return;

    const newMapping = {
      taxAccountType: field === 'taxAccountType' ? value : (row.taxAccountType || 'Unknown'),
      bookTreatment: field === 'bookTreatment' ? value : (row.bookTreatment || 'permanent'),
      timingCategory: field === 'timingCategory' ? value : row.timingCategory,
    };

    try {
      await mappingApi.override(accountId, newMapping);
      // If there's an open review item for this account, auto-resolve it as approved
      if (row.reviewItemId && row.reviewItemStatus === 'open') {
        await provApi.resolveItem(selectedRun!, row.reviewItemId, { resolution: 'approved', resolutionNote: 'Inline override' });
      }
      await selectRun(selectedRun!);
      load();
    } catch (err: any) {
      alert('Failed to update mapping: ' + err.message);
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

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      needs_review: 'bg-yellow-100 text-yellow-700',
      calculated: 'bg-blue-100 text-blue-700',
      workpapers_generated: 'bg-green-100 text-green-700',
      finalized: 'bg-gray-100 text-gray-700',
      locked: 'bg-gray-800 text-gray-100',
      failed: 'bg-red-100 text-red-700',
    };
    return colors[status] ?? 'bg-gray-100 text-gray-500';
  };

  const renderStepper = (status: string, approvalStatus: string) => {
    const steps = [
      { id: 'draft', label: 'Draft', active: status !== 'locked' && approvalStatus === 'not_required' },
      { id: 'needs_review', label: 'Needs Review', active: status === 'needs_review' && approvalStatus === 'pending' },
      { id: 'pending_partner', label: 'Pending Partner Sign-off', active: approvalStatus === 'pending_partner_review' },
      { id: 'approved', label: 'Approved', active: approvalStatus === 'approved' },
      { id: 'locked', label: 'Locked', active: status === 'locked' },
    ];

    return (
      <div className="flex items-center space-x-4 mb-4">
        {steps.map((step, idx) => (
          <div key={step.id} className="flex items-center">
            <div className={`px-3 py-1 rounded-full text-xs font-medium border ${step.active ? 'bg-brand-600 text-white border-brand-600' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
              {step.label}
            </div>
            {idx < steps.length - 1 && <div className="w-8 h-px bg-gray-300 mx-2"></div>}
          </div>
        ))}
      </div>
    );
  };

  if (loading && queue.length === 0 && allRuns.length === 0) {
    return <p className="text-gray-500">Loading review queue...</p>;
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h2 className="text-2xl font-bold">Review Dashboard</h2>
        <button onClick={load} className="text-sm text-brand-600 hover:text-brand-700">Refresh</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left pane: Queue & Runs or Split Screen left side */}
        <div className={`flex flex-col min-h-0 ${selectedRun ? 'lg:col-span-8' : 'lg:col-span-12'}`}>
          {!selectedRun ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 overflow-auto">
              <div>
                <h3 className="font-semibold mb-3">Needs Review</h3>
                {queue.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
                    <p className="text-gray-500 text-sm">No runs awaiting review</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {queue.map(({ run, openItems }) => (
                      <button
                        key={run.id}
                        onClick={() => selectRun(run.id)}
                        className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-brand-300 transition"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-medium">{run.period}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs ${getStatusBadge(run.status)}`}>
                            {run.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">{openItems.length} open item(s)</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 className="font-semibold mb-3">All Runs</h3>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Period</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allRuns.map((r: any) => (
                        <tr key={r.id} onClick={() => selectRun(r.id)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                          <td className="px-3 py-2">{r.period}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs ${getStatusBadge(r.status)}`}>
                              {r.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-500 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-full overflow-hidden shadow-sm">
              <div className="p-4 border-b border-gray-200 bg-gray-50 shrink-0 flex justify-between items-start">
                <div>
                  <button onClick={() => setSelectedRun(null)} className="text-xs text-gray-500 hover:text-gray-700 mb-2">← Back to Runs</button>
                  <h3 className="font-bold text-lg">{selectedRunDetails?.period} Provision</h3>
                </div>
                <div className="flex gap-2 mt-4">
                  {selectedRunDetails?.approvalStatus === 'pending' && (
                    <>
                      <button onClick={() => bulkResolve('approved')} disabled={actionLoading === 'bulk'} className="text-xs bg-brand-600 text-white px-3 py-1.5 rounded hover:bg-brand-700 disabled:opacity-50">Approve All Items</button>
                      <button onClick={submitForApproval} disabled={actionLoading === 'submit' || selectedRunItems.some(i => i.status === 'open')} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50">Submit for Approval</button>
                    </>
                  )}
                  {selectedRunDetails?.approvalStatus === 'pending_partner_review' && (
                    <button onClick={partnerApprove} disabled={actionLoading === 'approve'} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 disabled:opacity-50">Partner Sign-off</button>
                  )}
                  {selectedRunDetails?.approvalStatus === 'approved' && selectedRunDetails?.status !== 'locked' && (
                    <button onClick={lockRun} disabled={actionLoading === 'lock'} className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded hover:bg-gray-900 disabled:opacity-50">Lock Final Provision</button>
                  )}
                </div>
              </div>

              <div className="p-4 border-b border-gray-200 overflow-x-auto shrink-0">
                 {renderStepper(selectedRunDetails?.status || 'needs_review', selectedRunDetails?.approvalStatus || 'pending')}
              </div>

              <div className="flex border-b border-gray-200 shrink-0">
                <button
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === 'queue' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setActiveTab('queue')}
                >
                  Review Queue {selectedRunItems.filter(i => i.status === 'open').length > 0 && `(${selectedRunItems.filter(i => i.status === 'open').length})`}
                </button>
                <button
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === 'tb' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setActiveTab('tb')}
                >
                  GL Trial Balance
                </button>
              </div>

              <div className="flex-1 overflow-auto bg-gray-50 p-4">
                {activeTab === 'queue' && (
                  <div className="space-y-3">
                    {selectedRunItems.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center mt-8">No review items for this run.</p>
                    ) : (
                      selectedRunItems.map((item: any) => (
                        <div key={item.id} className={`bg-white rounded-xl border p-4 shadow-sm ${item.status === 'resolved' ? 'border-green-200 border-l-4 border-l-green-500' : item.status === 'rejected' ? 'border-red-200 border-l-4 border-l-red-500' : 'border-gray-200 border-l-4 border-l-yellow-500'}`}>
                          <div className="flex justify-between mb-2">
                            <span className="font-semibold text-sm">{item.title}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs ${item.status === 'resolved' ? 'bg-green-100 text-green-800' : item.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{item.status}</span>
                          </div>
                          <p className="text-xs text-gray-600">{item.description}</p>
                          {item.status === 'open' && (
                            <div className="flex gap-2 mt-4">
                              <button onClick={() => resolveItem(item.id, 'approved')} disabled={actionLoading === item.id} className="text-xs bg-green-50 text-green-700 border border-green-200 px-3 py-1 rounded hover:bg-green-100">Approve AI Choice</button>
                              <button onClick={() => resolveItem(item.id, 'rejected')} disabled={actionLoading === item.id} className="text-xs bg-red-50 text-red-700 border border-red-200 px-3 py-1 rounded hover:bg-red-100">Reject</button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'tb' && (
                  <div className="bg-white rounded border border-gray-200 overflow-x-auto h-full">
                    <table className="w-full text-xs text-left whitespace-nowrap">
                      <thead className="bg-gray-100 sticky top-0 border-b border-gray-200 shadow-sm z-10">
                        <tr>
                          <th className="px-3 py-2 font-medium text-gray-600">Account</th>
                          <th className="px-3 py-2 font-medium text-gray-600 text-right">Balance</th>
                          <th className="px-3 py-2 font-medium text-gray-600">Tax Category</th>
                          <th className="px-3 py-2 font-medium text-gray-600">Treatment</th>
                          <th className="px-3 py-2 font-medium text-gray-600">Review</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {tbDetails.map((row: any) => (
                          <tr key={row.accountId} className={`hover:bg-gray-50 ${row.reviewItemStatus === 'open' ? 'bg-yellow-50' : ''}`}>
                            <td className="px-3 py-2">
                              <span className="font-mono text-gray-500 mr-2">{row.accountNumber}</span>
                              <span className="font-medium">{row.accountName}</span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {Number(row.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2">
                              {selectedRunDetails?.status !== 'locked' ? (
                                <select 
                                  value={row.taxAccountType || ''} 
                                  onChange={(e) => updateInlineMapping(row.accountId, 'taxAccountType', e.target.value)}
                                  className="text-xs border-gray-300 rounded py-1 pl-2 pr-6 focus:ring-brand-500 focus:border-brand-500"
                                >
                                  <option value="">-- Unmapped --</option>
                                  <option value="Meals & Entertainment">Meals & Ent.</option>
                                  <option value="Penalties">Penalties</option>
                                  <option value="Depreciation">Depreciation</option>
                                  <option value="R&D Expenses">R&D Expenses</option>
                                  <option value="Office Supplies">Office Supplies</option>
                                  <option value="Revenue">Revenue</option>
                                  <option value="COGS">COGS</option>
                                  <option value="Other">Other</option>
                                </select>
                              ) : (
                                <span>{row.taxAccountType}</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {selectedRunDetails?.status !== 'locked' ? (
                                <select 
                                  value={row.bookTreatment || ''} 
                                  onChange={(e) => updateInlineMapping(row.accountId, 'bookTreatment', e.target.value)}
                                  className="text-xs border-gray-300 rounded py-1 pl-2 pr-6 focus:ring-brand-500 focus:border-brand-500"
                                >
                                  <option value="no_diff">No Diff</option>
                                  <option value="permanent">Permanent</option>
                                  <option value="temporary">Temporary</option>
                                </select>
                              ) : (
                                <span>{row.bookTreatment}</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {row.reviewItemStatus === 'open' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-800">Review</span>
                              )}
                              {row.reviewItemStatus === 'resolved' && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">Approved</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right pane: Eve & AI findings */}
        {selectedRun && (
          <div className="lg:col-span-4 flex flex-col gap-6 min-h-0">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col flex-1 shadow-sm">
              <div className="p-4 border-b border-gray-200 bg-gray-50 shrink-0">
                <h3 className="font-semibold text-gray-800">Audit Documentation</h3>
              </div>
              <div className="p-4 flex-1 overflow-auto">
                <AiFindingsPanel findings={aiFindings} />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 shrink-0 shadow-sm">
              <h3 className="font-semibold mb-3 text-gray-800">Eve Assistant</h3>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={evePrompt}
                  onChange={(e) => setEvePrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && askEve()}
                  placeholder="Ask a technical tax question..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button onClick={askEve} className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700 transition">
                  Ask
                </button>
              </div>
              {eveAnswer && (
                <div className="bg-brand-50 border border-brand-100 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap max-h-48 overflow-auto">
                  {eveAnswer}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
