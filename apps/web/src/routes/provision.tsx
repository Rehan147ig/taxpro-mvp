import { createFileRoute } from '@tanstack/react-router';
import ProvisionPage from '../pages/ProvisionPage';

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-100 rounded-xl h-24" />
        ))}
      </div>
      <div className="bg-gray-100 rounded-xl h-96" />
    </div>
  );
}

export const Route = createFileRoute('/provision')({
  component: ProvisionPage,
  pendingComponent: Skeleton,
});
