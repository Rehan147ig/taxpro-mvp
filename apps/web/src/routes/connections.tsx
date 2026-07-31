import { createFileRoute } from '@tanstack/react-router';
import ConnectionsPage from '../pages/ConnectionsPage';

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <div key={i} className="bg-gray-100 rounded-xl h-64" />
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/connections')({
  component: ConnectionsPage,
  pendingComponent: Skeleton,
});
