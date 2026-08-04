import React, { useEffect, useState } from 'react';
import { reviewItems as reviewApi, documents as docsApi } from '../api/client';

export default function ReviewItemsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionItem, setActionItem] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [i, d] = await Promise.all([reviewApi.list(), docsApi.list()]);
      setItems(i);
      setDocs(d);
    } catch (err: any) {
      setError(err.message || 'Failed to load review items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const run = async (id: string, fn: () => Promise<any>) => {
    setActionItem(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err: any) {
      setError(err.message || 'Action failed');
    } finally {
      setActionItem(null);
      setNote('');
    }
  };

  const openDetail = async (id: string) => {
    try {
      const { events } = await reviewApi.detail(id);
      setEvents(events);
      setShowDetail(id);
    } catch (err: any) {
      setError(err.message || 'Failed to load history');
    }
  };

  const StatusBadge = ({ status }: { status: string }) => {
    const color = status === 'open' ? 'bg-red-50 text-red-700 border-red-200'
      : status === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-200'
        : status === 'waiting_for_evidence' ? 'bg-amber-50 text-amber-800 border-amber-200'
          : status === 'waived' ? 'bg-purple-50 text-purple-700 border-purple-200'
            : status === 'resolved' ? 'bg-[#E8F7F0] text-[#10B981] border-[#10B981]/30'
              : 'bg-gray-100 text-gray-500 border-gray-200';
    return <span className={`px-1.5 py-0.5 rounded-button text-[10px] font-semibold border ${color}`}>{status}</span>;
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex justify-between items-center pb-2 border-b border-gray-200">
        <div>
          <h2 className="text-2xl font-serif font-semibold text-[#0A192F] tracking-tight">Review Items (Phase B)</h2>
          <p className="text-xs text-gray-500 mt-1">
            Lifecycle: open → in_progress → waiting_for_evidence → resolved. Waiver requires a human partner/admin and a reason — every move is on the append-only audit trail
          </p>
        </div>
        <button onClick={load} className="text-xs text-[#0A192F] font-semibold hover:underline bg-white border border-gray-200 px-3 py-1.5 rounded-button shadow-sm">Refresh</button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-card p-4 text-xs font-medium">{error}</div>}
      {loading && <p className="text-xs text-gray-500">Loading review items…</p>}

      {items.length === 0 && !loading && (
        <div className="bg-white rounded-card border border-gray-200 p-6 text-center shadow-sm">
          <p className="text-gray-500 text-xs">No review items. Start a provision run or create a non-standard period to generate some.</p>
        </div>
      )}

      {items.map((it: any) => (
        <div key={it.id} className="bg-white rounded-card border border-gray-200 p-4 shadow-sm space-y-3">
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2">
                <StatusBadge status={it.status} />
                <span className={`px-1.5 py-0.5 rounded-button text-[10px] font-semibold border ${
                  it.severity === 'high' ? 'bg-red-50 text-red-700 border-red-200' : it.severity === 'medium' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}>{it.severity}</span>
                <span className="text-[10px] text-gray-400 font-mono">{it.itemType}</span>
                {it.sourceRef && <span className="text-[10px] text-gray-400 font-mono">{it.sourceRef}</span>}
              </div>
              <h3 className="text-sm font-serif font-semibold text-[#0A192F] mt-1.5">{it.title}</h3>
              <p className="text-xs text-gray-600 mt-1">{it.description}</p>
              {it.evidenceRequested && (
                <p className="text-[11px] text-amber-800 mt-1.5 bg-amber-50 border border-amber-200 rounded-button px-2 py-1 inline-block">
                  Evidence requested: {it.evidenceRequested}
                </p>
              )}
              {it.dueDate && <p className="text-[11px] text-gray-500 mt-1">Due: {it.dueDate}</p>}
            </div>
            <button onClick={() => openDetail(it.id)} className="text-[10px] text-[#0A192F] font-semibold hover:underline whitespace-nowrap">History</button>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {it.status === 'open' && (
              <button onClick={() => run(it.id, () => reviewApi.start(it.id))} disabled={actionItem === it.id}
                className="text-[10px] font-semibold bg-[#0A192F] text-white px-2.5 py-1.5 rounded-button disabled:opacity-50">
                Start
              </button>
            )}
            {(it.status === 'in_progress' || it.status === 'open') && (
              <button
                onClick={() => {
                  if (!note.trim()) { setError('Describe the evidence needed first.'); return; }
                  run(it.id, () => reviewApi.requestEvidence(it.id, note.trim()));
                }}
                disabled={actionItem === it.id}
                className="text-[10px] font-semibold bg-white text-amber-700 border border-amber-300 px-2.5 py-1.5 rounded-button disabled:opacity-50"
              >
                Request Evidence
              </button>
            )}
            {it.status === 'waiting_for_evidence' && (
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) run(it.id, () => reviewApi.attachEvidence(it.id, e.target.value));
                }}
                className="text-[10px] border border-gray-300 rounded-button px-2 py-1.5 bg-white"
              >
                <option value="" disabled>Attach document…</option>
                {docs.map((d: any) => <option key={d.id} value={d.id}>{d.filename} (v{d.version})</option>)}
              </select>
            )}
            <input
              value={actionItem === it.id ? note : ''}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason (required for waiver/reopen)"
              className="text-[10px] border border-gray-300 rounded-button px-2 py-1.5 w-56 bg-white"
            />
            <button
              onClick={() => {
                if (!note.trim()) { setError('A waiver requires a reason.'); return; }
                run(it.id, () => reviewApi.waive(it.id, note.trim()));
              }}
              disabled={actionItem === it.id || ['resolved', 'rejected', 'waived'].includes(it.status)}
              className="text-[10px] font-semibold bg-purple-600 text-white px-2.5 py-1.5 rounded-button disabled:opacity-40"
            >
              Waive
            </button>
            {['resolved', 'rejected', 'waived'].includes(it.status) && (
              <button
                onClick={() => {
                  if (!note.trim()) { setError('A reason is required to reopen.'); return; }
                  run(it.id, () => reviewApi.reopen(it.id, note.trim()));
                }}
                disabled={actionItem === it.id}
                className="text-[10px] font-semibold bg-white text-gray-700 border border-gray-300 px-2.5 py-1.5 rounded-button disabled:opacity-50"
              >
                Reopen
              </button>
            )}
          </div>

          {showDetail === it.id && (
            <div className="border-t border-gray-100 pt-2">
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Decision history (append-only)</h4>
              {events.length === 0 && <p className="text-[10px] text-gray-400">No events recorded.</p>}
              {events.map((ev: any) => (
                <div key={ev.id} className="flex gap-2 text-[10px] text-gray-500 py-0.5">
                  <span className="font-mono text-gray-400">{new Date(ev.createdAt).toLocaleString()}</span>
                  <span className="font-semibold text-[#0A192F]">{ev.eventType}</span>
                  <span className="truncate">{ev.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
