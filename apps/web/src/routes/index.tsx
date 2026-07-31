import { createFileRoute } from '@tanstack/react-router';
import { useStore } from '../stores/provision.store';
import LoginPage from '../pages/LoginPage';
import Dashboard from '../pages/Dashboard';

function Index() {
  const { isAuthenticated } = useStore();
  if (!isAuthenticated) return <LoginPage />;
  return <Dashboard />;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-gray-100 rounded-xl h-32" />
        ))}
      </div>
      <div className="bg-gray-100 rounded-xl h-48" />
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: Index,
  pendingComponent: Skeleton,
});
