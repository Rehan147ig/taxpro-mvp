const STEPS = [
  { id: 'draft', label: 'Draft' },
  { id: 'mapping', label: 'AI Mapping' },
  { id: 'needs_review', label: 'Needs Review' },
  { id: 'pending_partner', label: 'Partner Sign-off' },
  { id: 'approved', label: 'Approved' },
  { id: 'locked', label: 'Locked' },
];

function currentStepIndex(status: string, approvalStatus: string): number {
  if (status === 'failed') return -1;
  if (status === 'locked') return 5;
  if (approvalStatus === 'approved') return 4;
  if (approvalStatus === 'pending_partner_review') return 3;
  if (['needs_review', 'calculated', 'workpapers_generated', 'finalized'].includes(status)) return 2;
  if (status !== 'normalized') return 1;
  return 0;
}

export function RunStepper({ status, approvalStatus, exceptionSummary }: { status: string; approvalStatus: string; exceptionSummary?: string | null }) {
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

  const currentIdx = currentStepIndex(status, approvalStatus);
  return (
    <div className="flex items-center space-x-4 mb-4">
      {STEPS.map((step, idx) => {
        let className = 'bg-gray-50 text-gray-400 border-gray-200';
        if (idx < currentIdx) className = 'bg-brand-100 text-brand-700 border-brand-300';
        if (idx === currentIdx) className = 'bg-brand-600 text-white border-brand-600';
        return (
          <div key={step.id} className="flex items-center">
            <div className={`px-3 py-1 rounded-full text-xs font-medium border ${className}`}>{step.label}</div>
            {idx < STEPS.length - 1 && <div className={`w-8 h-px mx-2 ${idx < currentIdx ? 'bg-brand-300' : 'bg-gray-300'}`} />}
          </div>
        );
      })}
    </div>
  );
}
