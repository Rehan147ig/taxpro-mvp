const STATUS_COLORS: Record<string, string> = {
  needs_review: 'bg-yellow-100 text-yellow-700',
  calculated: 'bg-blue-100 text-blue-700',
  workpapers_generated: 'bg-green-100 text-green-700',
  finalized: 'bg-gray-100 text-gray-700',
  locked: 'bg-gray-800 text-gray-100',
  failed: 'bg-red-100 text-red-700',
};

export function RunStatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-500';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs ${color}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
