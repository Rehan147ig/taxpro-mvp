export default function AuditTrailList({ events }: { events: any[] }) {
  if (events.length === 0) {
    return <p className="text-gray-500 text-sm text-center mt-8">No audit events recorded for this run.</p>;
  }
  return (
    <div className="space-y-2">
      {events.map((ev: any) => (
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
      ))}
    </div>
  );
}
