import React, { useEffect, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { provision as provApi } from '../api/client';
import { RunStatusBadge } from '../components/RunStatusBadge';
import { RunStepper } from '../components/RunStepper';
import TrialBalanceTable from '../components/TrialBalanceTable';

type Tab = 'items' | 'tb';

export default function RunDetailPage() {
  const { runId } = useParams({ from: '/runs/$runId' });
  const [run, setRun] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [tbDetails, setTbDetails] = useState<any[]>([]);
  const [comparison, setComparison] = useState<{ previousPeriod: string | null; delta: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('items');

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [runs, items, tb, cmp] = await Promise.all([
        provApi.runs(),
        provApi.runReviewItems(runId),
        provApi.runTrialBalanceDetail(runId),
        provApi.compare(runId),
      ]);
      setRun(runs.find((r: any) => r.id === runId) ?? null);
      setItems(items);
      setTbDetails(tb);
      setComparison(cmp);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load run');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [runId]);

  const runAction = async (action: string, fn: () => Promise<any>) => {
    setActionLoading(action);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Request failed');
      setTimeout(() => setActionError(null), 5000);
    } finally {
      setActionLoading(null);
    }
  };

  const openItems = items.filter(i => i.status === 'open');
  const locked = run?.status === 'locked';

  if (loading && !run) {
    return <p className="text-gray-500">Loading run...</p>;
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <div className="mb-2 shrink-0">
        <Link to="/review" className="text-xs text-gray-500 hover:text-gray-700">← Back to Review Queue</Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-full overflow-hidden shadow-sm">
        <div className="p-4 border-b border-gray-200 bg-gray-50 shrink-0 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-lg">{run?.period ?? 'Run'} Provision</h3>
              {run && <RunStatusBadge status={run.status} />}
            </div>
            {run?.submittedAt && (
              <p className="text-xs text-gray-500 mt-1">
                Submitted by {run.submittedByUserId || 'User'} on {new Date(run.submittedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            {run?.approvedAt && (
              <p className="text-xs text-green-700 mt-1">
                Approved by {run.approvedByUserEmail || run.approvedByUserId || 'Partner'} on {new Date(run.approvedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            {run?.lockedAt && (
              <p className="text-xs text-gray-700 mt-1">
                Locked by {run.lockedByUserId || 'Partner'} on {new Date(run.lockedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {actionError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-1.5 text-xs max-w-xs">{actionError}</div>
            )}
            <div className="flex gap-2">
              {locked && <span className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded font-medium">Locked</span>}
              {['not_required', 'pending'].includes(run?.approvalStatus) && !locked && run?.status !== 'failed' && (
                <>
                  {openItems.length > 0 && (
                    <button
                      onClick={() => runAction('bulk', () => provApi.bulkResolve(runId, { resolution: 'approved' }))}
                      disabled={actionLoading === 'bulk'}
                      className="text-xs bg-brand-600 text-white px-3 py-1.5 rounded hover:bg-brand-700 disabled:opacity-50"
                    >
                      Approve All Items
                    </button>
                  )}
                  <button
                    onClick={() => runAction('submit', () => provApi.submitForApproval(runId))}
                    disabled={actionLoading === 'submit'}
                    className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Submit for Approval
                  </button>
                </>
              )}
              {run?.approvalStatus === 'pending_partner_review' && !locked && (
                <button
                  onClick={() => runAction('approve', () => provApi.partnerApprove(runId))}
                  disabled={actionLoading === 'approve'}
                  className="text-xs bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Partner Sign-off
                </button>
              )}
              {run?.approvalStatus === 'approved' && !locked && (
                <button
                  onClick={() => { if (window.confirm('Lock this provision? Once locked, mappings and journal entries cannot be edited. Are you sure?')) runAction('lock', () => provApi.lockRun(runId)); }}
                  disabled={actionLoading === 'lock'}
                  className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded hover:bg-gray-900 disabled:opacity-50"
                >
                  Lock Final Provision
                </button>
              )}
              {locked && (
                <Link to="/runs/$runId/export" params={{ runId }} className="text-xs bg-brand-600 text-white px-3 py-1.5 rounded hover:bg-brand-700">
                  Export Package
                </Link>
              )}
            </div>
            <div className="flex gap-2 text-xs">
              <Link to="/runs/$runId/findings" params={{ runId }} className="text-brand-600 hover:underline">AI Findings</Link>
              <Link to="/runs/$runId/audit" params={{ runId }} className="text-brand-600 hover:underline">Audit Events</Link>
              <Link to="/runs/$runId/export" params={{ runId }} className="text-brand-600 hover:underline">Exports</Link>
            </div>
          </div>
        </div>

        <div className="p-4 border-b border-gray-200 overflow-x-auto shrink-0">
          <RunStepper status={run?.status ?? 'needs_review'} approvalStatus={run?.approvalStatus ?? 'pending'} exceptionSummary={run?.exceptionSummary} />
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
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === 'items' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('items')}
          >
            Review Items {openItems.length > 0 && `(${openItems.length})`}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === 'tb' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('tb')}
          >
            GL Trial Balance
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-gray-50 p-4">
          {loadError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-4 text-sm flex justify-between items-center">
              <span>{loadError}</span>
              <button onClick={load} className="text-red-700 font-medium hover:underline ml-4 whitespace-nowrap">Retry</button>
            </div>
          )}
          {activeTab === 'items' && (
            <div className="space-y-3">
              {items.length === 0 ? (
                <p className="text-gray-500 text-sm text-center mt-8">No review items for this run.</p>
              ) : (
                items.map((item: any) => (
                  <div key={item.id} className={`bg-white rounded-xl border p-4 shadow-sm ${item.status === 'resolved' ? 'border-green-200 border-l-4 border-l-green-500' : item.status === 'rejected' ? 'border-red-200 border-l-4 border-l-red-500' : 'border-gray-200 border-l-4 border-l-yellow-500'}`}>
                    <div className="flex justify-between mb-2">
                      <span className="font-semibold text-sm">{item.title}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${item.status === 'resolved' ? 'bg-green-100 text-green-800' : item.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>{item.status}</span>
                    </div>
                    <p className="text-xs text-gray-600">{item.description}</p>
                    {item.status === 'open' && (
                      <div className="flex gap-2 mt-4">
                        <button onClick={() => runAction(item.id, () => provApi.resolveItem(runId, item.id, { resolution: 'approved' }))} disabled={actionLoading === item.id} className="text-xs bg-green-50 text-green-700 border border-green-200 px-3 py-1 rounded hover:bg-green-100">Approve AI Choice</button>
                        <button onClick={() => runAction(item.id, () => provApi.resolveItem(runId, item.id, { resolution: 'rejected' }))} disabled={actionLoading === item.id} className="text-xs bg-red-50 text-red-700 border border-red-200 px-3 py-1 rounded hover:bg-red-100">Reject</button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
          {activeTab === 'tb' && (
            <TrialBalanceTable rows={tbDetails} runStatus={run?.status} runId={runId} onChanged={load} />
          )}
        </div>
      </div>
    </div>
  );
}
