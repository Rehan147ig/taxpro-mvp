import React from 'react';
import { useStore } from './stores/provision.store';
import { pageViewCounter } from './observability';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import ConnectionsPage from './pages/ConnectionsPage';
import MappingPage from './pages/MappingPage';
import ProvisionPage from './pages/ProvisionPage';
import ReviewDashboard from './pages/ReviewDashboard';

const ROUTE_LABELS: Record<string, string> = {
  '/': 'dashboard',
  '/connections': 'connections',
  '/mapping': 'mapping',
  '/provision': 'provision',
  '/review': 'review',
};

function App() {
  const { isAuthenticated, logout } = useStore();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Simple hash-based routing for MVP (no router dependency)
  const route = window.location.hash.slice(1) || '/';

  const navigate = (path: string) => {
    window.location.hash = path;
    // Force re-render
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  // Use a simple state to track hash changes
  const [currentRoute, setCurrentRoute] = React.useState(route);

  React.useEffect(() => {
    const handler = () => setCurrentRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // Track page views
  React.useEffect(() => {
    const label = ROUTE_LABELS[currentRoute] || 'unknown';
    pageViewCounter.add(1, { route: label });
  }, [currentRoute]);

  const NavLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
    <button
      onClick={() => navigate(to)}
      className={`w-full text-left px-4 py-2 text-sm rounded-lg transition ${
        currentRoute === to
          ? 'bg-brand-600 text-white'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-brand-600">TaxPro</h1>
          <p className="text-xs text-gray-400 mt-1">AI-Native Tax Provision</p>
        </div>

        <nav className="flex flex-col gap-1 flex-1">
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/connections">Data Sources</NavLink>
          <NavLink to="/mapping">Tax Mapping</NavLink>
          <NavLink to="/provision">Provision</NavLink>
          <NavLink to="/review">Review</NavLink>
        </nav>

        <button
          onClick={logout}
          className="text-sm text-red-600 hover:text-red-800 text-left py-2"
        >
          Logout
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">
        {currentRoute === '/' && <Dashboard />}
        {currentRoute === '/connections' && <ConnectionsPage />}
        {currentRoute === '/mapping' && <MappingPage />}
        {currentRoute === '/provision' && <ProvisionPage />}
        {currentRoute === '/review' && <ReviewDashboard />}
      </main>
    </div>
  );
}

export default App;
