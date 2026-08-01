import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="bg-gray-100 rounded-xl h-32" />
      <div className="bg-gray-100 rounded-xl h-96" />
    </div>
  );
}

export const Route = createFileRoute('/runs/$runId/')({
  component: lazyRouteComponent(() => import('../pages/RunDetailPage')),
  pendingComponent: Skeleton,
});
