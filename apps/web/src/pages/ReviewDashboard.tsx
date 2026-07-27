import React, { useEffect, useState } from 'react';
import { provision as provApi, mappings as mappingApi } from '../api/client';
import AiFindingsPanel from '../components/AiFindingsPanel';

const TAX_ACCOUNT_TYPE_OPTIONS: { value: string; label: string; group: string }[] = [
  { value: 'PERM_MEALS_ENTERTAINMENT', label: 'Meals & Entertainment', group: 'Permanent Differences' },
  { value: 'PERM_PENALTIES_FINES', label: 'Penalties & Fines', group: 'Permanent Differences' },
  { value: 'PERM_DIVIDENDS_RECEIVED_DEDUCTION', label: 'Dividends Received Deduction', group: 'Permanent Differences' },
  { value: 'PERM_LIFE_INSURANCE', label: 'Life Insurance', group: 'Permanent Differences' },
  { value: 'PERM_TAX_EXEMPT_INTEREST', label: 'Tax-Exempt Interest', group: 'Permanent Differences' },
  { value: 'PERM_NONDEDUCTIBLE_GOODWILL', label: 'Nondeductible Goodwill', group: 'Permanent Differences' },
  { value: 'PERM_OTHER', label: 'Other Permanent', group: 'Permanent Differences' },
  { value: 'TEMP_DEPRECIATION', label: 'Depreciation', group: 'Temporary Differences' },
  { value: 'TEMP_AMORTIZATION', label: 'Amortization', group: 'Temporary Differences' },
  { value: 'TEMP_ACCELERATED_DEPRECIATION', label: 'Accelerated Depreciation', group: 'Temporary Differences' },
  { value: 'TEMP_BONUS_DEPRECIATION', label: 'Bonus Depreciation', group: 'Temporary Differences' },
  { value: 'TEMP_SECTION_179', label: 'Section 179', group: 'Temporary Differences' },
  { value: 'TEMP_RESEARCH_CREDIT', label: 'R&D Credit', group: 'Temporary Differences' },
  { value: 'TEMP_BAD_DEBT_RESERVE', label: 'Bad Debt Reserve', group: 'Temporary Differences' },
  { value: 'TEMP_INVENTORY_RESERVE', label: 'Inventory Reserve', group: 'Temporary Differences' },
  { value: 'TEMP_WARRANTY_RESERVE', label: 'Warranty Reserve', group: 'Temporary Differences' },
  { value: 'TEMP_DEFERRED_REVENUE', label: 'Deferred Revenue', group: 'Temporary Differences' },
  { value: 'TEMP_ACCRUED_LIABILITIES', label: 'Accrued Liabilities', group: 'Temporary Differences' },
  { value: 'TEMP_PENSION', label: 'Pension', group: 'Temporary Differences' },
  { value: 'TEMP_NOL_CARRYFORWARD', label: 'NOL Carryforward', group: 'Temporary Differences' },
  { value: 'TEMP_TAX_CREDIT_CARRYFORWARD', label: 'Tax Credit Carryforward', group: 'Temporary Differences' },
  { value: 'TEMP_OTHER', label: 'Other Temporary', group: 'Temporary Differences' },
  { value: 'NODIFF_CASH', label: 'Cash', group: 'No Difference' },
  { value: 'NODIFF_AR', label: 'Accounts Receivable', group: 'No Difference' },
  { value: 'NODIFF_AP', label: 'Accounts Payable', group: 'No Difference' },
  { value: 'NODIFF_REVENUE', label: 'Revenue', group: 'No Difference' },
  { value: 'NODIFF_SALARIES', label: 'Salaries', group: 'No Difference' },
  { value: 'NODIFF_RENT', label: 'Rent', group: 'No Difference' },
  { value: 'NODIFF_UTILITIES', label: 'Utilities', group: 'No Difference' },
  { value: 'NODIFF_OTHER', label: 'Other No Difference', group: 'No Difference' },
];

const taxAccountTypeGroups = [...new Set(TAX_ACCOUNT_TYPE_OPTIONS.map(o => o.group))];

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  
  const [comparison, setComparison] = useState<{ previousPeriod: string | null; delta: any } | null>(null);
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'queue' | 'tb' | 'events'>('queue');
  const [taxAdvisorPrompt, setTaxAdvisorPrompt] = useState('');
  const [taxAdvisorAnswer, setTaxAdvisorAnswer] = useState('');
  const [aiFindings, setAiFindings] = useState<{ pending: boolean; agents: any[] } | null>(null);
  const [runEvents, setRunEvents] = useState<any[]>([]);

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
    setLoadError(null);
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
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load review data');
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
    try {
      setComparison(await provApi.compare(runId));
    } catch {
      setComparison(null);
    }
    try {
      setRunEvents(await provApi.events(runId));
    } catch {
      setRunEvents([]);
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
      setActionError(err.message || 'Request failed');
      setTimeout(() => setActionError(null), 5000);
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
      setActionError(err.message || 'Request failed');
      setTimeout(() => setActionError(null), 5000);
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
      setActionError(err.message || 'Request failed');
      setTimeout(() => setActionError(null), 5000);
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
      setActionError(err.message || 'Request failed');
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const lockRun = async () => {
    if (!selectedRun) return;
    if (!window.confirm('Lock this provision? Once locked, mappings and journal entries cannot be edited. Are you sure?')) return;
    setActionLoading('lock');
    try {
      await provApi.lockRun(selectedRun);
      await selectRun(selectedRun);
      load();
    } catch (err: any) {
      setActionError(err.message || 'Request failed');
      setTimeout(() => setActionError(null), 5000);
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

  const askTaxAdvisor = async () => {
    if (!taxAdvisorPrompt.trim()) return;
    setTaxAdvisorAnswer('Thinking...');
    try {
      const res = await provApi.eveAsk(taxAdvisorPrompt);
      setTaxAdvisorAnswer(res.answer + (res.suggestedAction ? `\n\nSuggested action: ${res.suggestedAction}` : ''));
    } catch {
      setTaxAdvisorAnswer('Tax Advisor is currently unavailable. Try again later.');
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

  const renderStepper = (status: string, approvalStatus: string, exceptionSummary?: string | null) => {
    if (status === 'failed') {
      return (
        <div className="mb-4">
          <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold">Failed</span>
              <span>— This provision run failed and requires attention.</span>
            </div>
            {exceptionSummary && <p className="text-xs mt-1 opacity-80">{exceptionSummary}</p>}
          </div>
        </div>
      );
    }

    let currentIdx = 0;
    if (status === 'locked') currentIdx = 5;
    else if (approvalStatus === 'approved') currentIdx = 4;
    else if (approvalStatus === 'pending_partner_review') currentIdx = 3;
    else if (status === 'needs_review' || status === 'calculated' || status === 'workpapers_generated' || status === 'finalized') currentIdx = 2;
    else if (status !== 'normalized') currentIdx = 1;

    const steps = [
      { id: 'draft', label: 'Draft' },
      { id: 'mapping', label: 'AI Mapping' },
      { id: 'needs_review', label: 'Needs Review' },
      { id: 'pending_partner', label: 'Partner Sign-off' },
      { id: 'approved', label: 'Approved' },
      { id: 'locked', label: 'Locked' },
    ];

    return (
      <div className="flex items-center space-x-4 mb-4">
        {steps.map((step, idx) => {
          let className = 'bg-gray-50 text-gray-400 border-gray-200';
          if (idx < currentIdx) className = 'bg-brand-100 text-brand-700 border-brand-300';
          if (idx === currentIdx) className = 'bg-brand-600 text-white border-brand-600';
          return (
            <div key={step.id} className="flex items-center">
              <div className={`px-3 py-1 rounded-full text-xs font-medium border ${className}`}>{step.label}</div>
              {idx < steps.length - 1 && <div className={`w-8 h-px mx-2 ${idx < currentIdx ? 'bg-brand-300' : 'bg-gray-300'}`} />}
            </div>
          );
        })}
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

      {loadError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-4 text-sm flex justify-between items-center">
          <span>{loadError}</span>
          <button onClick={load} className="text-red-700 font-medium hover:underline ml-4 whitespace-nowrap">Retry</button>
        </div>
      )}

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
                    {queue.map((q: any) => {
                      const { run, openItems, maxSeverity } = q;
                      const severityLabel = maxSeverity === 0 ? 'High' : maxSeverity === 1 ? 'Medium' : 'Low';
                      const severityColor = maxSeverity === 0 ? 'bg-red-100 text-red-700' : maxSeverity === 1 ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700';
                      return (
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
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${severityColor}`}>{severityLabel} Priority</span>
                          <span className="text-xs text-gray-500">{openItems.length} open item(s)</span>
                        </div>
                      </button>
                      );
                    })}
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
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Version</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Status</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const latestPerPeriod = new Map<string, string>();
                          for (const r of allRuns) {
                            const key = r.period + '|' + (r.entityId || '');
                            if (!latestPerPeriod.has(key)) latestPerPeriod.set(key, r.id);
                          }
                          const versionCounts = new Map<string, number>();
                          return allRuns.map((r: any) => {
                            const key = r.period + '|' + (r.entityId || '');
                            const count = (versionCounts.get(key) ?? 0) + 1;
                            versionCounts.set(key, count);
                            const total = [...allRuns].filter(x => (x.period + '|' + (x.entityId || '')) === key).length;
                            const isLatest = r.id === latestPerPeriod.get(key);
                            return (
                              <tr key={r.id} onClick={() => selectRun(r.id)} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                                <td className="px-3 py-2">
                                  <span>{r.period}</span>
                                  {isLatest && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-100 text-brand-700">Latest</span>}
                                </td>
                                <td className="px-3 py-2 text-gray-500 text-xs">{count}/{total}</td>
                                <td className="px-3 py-2">
                                  <span className={`px-2 py-0.5 rounded-full text-xs ${getStatusBadge(r.status)}`}>
                                    {r.status.replace(/_/g, ' ')}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-gray-500 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                              </tr>
                            );
                          });
                        })()}
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
                  {selectedRunDetails?.submittedAt && (
                    <p className="text-xs text-gray-500 mt-1">
                      Submitted by {selectedRunDetails.submittedByUserId || 'User'} on {new Date(selectedRunDetails.submittedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                  {selectedRunDetails?.approvedAt && (
                    <p className="text-xs text-green-700 mt-1">
                      Approved by {selectedRunDetails.approvedByUserEmail || selectedRunDetails.approvedByUserId || 'Partner'} on {new Date(selectedRunDetails.approvedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                  {selectedRunDetails?.lockedAt && (
                    <p className="text-xs text-gray-700 mt-1">
                      Locked by {selectedRunDetails.lockedByUserId || 'Partner'} on {new Date(selectedRunDetails.lockedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                  {selectedRunDetails?.status === 'locked' && !selectedRunDetails?.lockedAt && (
                    <p className="text-xs text-gray-500 mt-1 italic">Approval history unavailable</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {actionError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-1.5 text-xs max-w-xs">{actionError}</div>
                  )}
                  <div className="flex gap-2">
                  {selectedRunDetails?.status === 'locked' && (
                    <span className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded font-medium"> Locked</span>
                  )}
                  {selectedRunDetails?.approvalStatus === 'pending' && selectedRunDetails?.status !== 'locked' && (
                    <>
                      <button onClick={() => bulkResolve('approved')} disabled={actionLoading === 'bulk'} className="text-xs bg-brand-600 text-white px-3 py-1.5 rounded hover:bg-brand-700 disabled:opacity-50">Approve All Items</button>
                      <button onClick={submitForApproval} disabled={actionLoading === 'submit' || selectedRunItems.some(i => i.status === 'open')} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50">Submit for Approval</button>
                    </>
                  )}
                  {selectedRunDetails?.approvalStatus === 'pending_partner_review' && selectedRunDetails?.status !== 'locked' && (
                    <button onClick={partnerApprove} disabled={actionLoading === 'approve'} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 disabled:opacity-50">Partner Sign-off</button>
                  )}
                  {selectedRunDetails?.approvalStatus === 'approved' && selectedRunDetails?.status !== 'locked' && (
                    <button onClick={lockRun} disabled={actionLoading === 'lock'} className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded hover:bg-gray-900 disabled:opacity-50">Lock Final Provision</button>
                  )}
                  </div>
                </div>
              </div>

              <div className="p-4 border-b border-gray-200 overflow-x-auto shrink-0">
                 {renderStepper(selectedRunDetails?.status || 'needs_review', selectedRunDetails?.approvalStatus || 'pending', selectedRunDetails?.exceptionSummary)}
              </div>

              {comparison?.delta && (
                <div className="px-4 py-2 border-b border-gray-200 bg-gray-50/50 text-xs flex gap-4 shrink-0">
                  <span className="text-gray-500 font-medium">vs {comparison.previousPeriod || 'prior'}:</span>
                  <span className={comparison.delta.bookIncome >= 0 ? 'text-green-600' : 'text-red-600'}>
                    Book Income {comparison.delta.bookIncome >= 0 ? '+' : ''}{Number(comparison.delta.bookIncome).toLocaleString()}
                  </span>
                  <span className={comparison.delta.totalTaxExpense >= 0 ? 'text-red-600' : 'text-green-600'}>
                    Tax Expense {comparison.delta.totalTaxExpense >= 0 ? '+' : ''}{Number(comparison.delta.totalTaxExpense).toLocaleString()}
                  </span>
                  <span className={comparison.delta.effectiveTaxRate >= 0 ? 'text-red-600' : 'text-green-600'}>
                    ETR {comparison.delta.effectiveTaxRate >= 0 ? '+' : ''}{(comparison.delta.effectiveTaxRate * 100).toFixed(2)}%
                  </span>
                  <span className={comparison.delta.taxPayable >= 0 ? 'text-red-600' : 'text-green-600'}>
                    Tax Payable {comparison.delta.taxPayable >= 0 ? '+' : ''}{Number(comparison.delta.taxPayable).toLocaleString()}
                  </span>
                </div>
              )}

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
                <button
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === 'events' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                  onClick={() => setActiveTab('events')}
                >
                  Audit Trail {runEvents.length > 0 && `(${runEvents.length})`}
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

                {activeTab === 'events' && (
                  <div className="space-y-2">
                    {runEvents.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center mt-8">No audit events recorded for this run.</p>
                    ) : (
                      runEvents.map((ev: any) => (
                        <div key={ev.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-sm flex items-start gap-3">
                          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-brand-400" />
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                              <span className="font-medium text-gray-800">{ev.eventType}</span>
                              <span className="text-[10px] text-gray-400 whitespace-nowrap ml-2">{new Date(ev.occurredAt).toLocaleString()}</span>
                            </div>
                            {ev.reason && <p className="text-gray-500 text-xs mt-0.5">{ev.reason}</p>}
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              Actor: {ev.actorType} {ev.actorUserId ? `(user: ${ev.actorUserId.slice(0, 8)}...)` : ev.actorAgentId ? `(agent: ${ev.actorAgentId.slice(0, 8)}...)` : ''}
                            </p>
                          </div>
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
                          <th className="px-3 py-2 font-medium text-gray-600">Provenance</th>
                          <th className="px-3 py-2 font-medium text-gray-600">Review</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {tbDetails.map((row: any) => (
                          <React.Fragment key={row.accountId}>
                          <tr className={`hover:bg-gray-50 ${row.reviewItemStatus === 'open' ? 'bg-yellow-50' : ''} ${expandedAccount === row.accountId ? 'bg-brand-50' : ''}`}>
                            <td className="px-3 py-2">
                              <button
                                onClick={() => setExpandedAccount(expandedAccount === row.accountId ? null : row.accountId)}
                                className="text-gray-400 hover:text-gray-600 mr-1 text-xs"
                              >
                                {expandedAccount === row.accountId ? '▼' : '▶'}
                              </button>
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
                                  {taxAccountTypeGroups.map(group => (
                                    <optgroup key={group} label={group}>
                                      {TAX_ACCOUNT_TYPE_OPTIONS.filter(o => o.group === group).map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </optgroup>
                                  ))}
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
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                row.suggestedByAi ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                              }`}>
                                {row.suggestedByAi ? 'AI' : 'Manual'}
                              </span>
                              {typeof row.confidenceScore === 'number' && (
                                <span className={`ml-1 text-[10px] ${row.confidenceScore >= 0.75 ? 'text-green-600' : 'text-yellow-600'}`}>
                                  {Math.round(row.confidenceScore * 100)}%
                                </span>
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
                          {expandedAccount === row.accountId && (
                            <tr className="bg-brand-50/50">
                              <td colSpan={6} className="px-6 py-3">
                                <div className="text-xs text-gray-600 space-y-1">
                                  <p><span className="font-medium text-gray-500">Source:</span> {row.type || 'GL Account'}</p>
                                  <p><span className="font-medium text-gray-500">Confidence Score:</span> {typeof row.confidenceScore === 'number' ? `${Math.round(row.confidenceScore * 100)}%` : 'N/A'}</p>
                                  <p><span className="font-medium text-gray-500">Classification Source:</span> {row.suggestedByAi ? 'AI-suggested (subagent_mapping_agent)' : 'Manual override'}</p>
                                  <p><span className="font-medium text-gray-500">Mapping Version:</span> {row.mappingVersion ?? 'v1'}</p>
                                  {row.reviewItemId && (
                                    <p><span className="font-medium text-gray-500">Review Status:</span> {row.reviewItemStatus} {row.reviewItemSeverity ? `(Severity: ${row.reviewItemSeverity})` : ''}</p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
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
              <div className="p-4 border-b border-gray-200 bg-gray-50 shrink-0 flex justify-between items-center">
                <h3 className="font-semibold text-gray-800">Audit Documentation</h3>
                {aiFindings?.agents?.find(a => a.workflowName === 'subagent_audit_defense')?.output && (
                  <button
                    onClick={() => {
                      const audit = aiFindings.agents.find(a => a.workflowName === 'subagent_audit_defense')?.output;
                      if (!audit) return;
                      const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `audit-memo-${selectedRunDetails?.period || 'run'}.json`;
                      link.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    Download Memo
                  </button>
                )}
              </div>
              <div className="p-4 flex-1 overflow-auto">
                <AiFindingsPanel findings={aiFindings} />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 shrink-0 shadow-sm">
              <h3 className="font-semibold mb-3 text-gray-800">Tax Advisor</h3>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={taxAdvisorPrompt}
                  onChange={(e) => setTaxAdvisorPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && askTaxAdvisor()}
                  placeholder="Ask a technical tax question..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button onClick={askTaxAdvisor} className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700 transition">
                  Ask
                </button>
              </div>
              {taxAdvisorAnswer && (
                <div className="bg-brand-50 border border-brand-100 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap max-h-48 overflow-auto">
                  {taxAdvisorAnswer}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
