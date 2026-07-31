// Replaced by TanStack Router.
// See src/routes/__root.tsx for layout + routes.
// This file is kept as a reference during migration.

import React from 'react';
import { useStore } from './stores/provision.store';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import ConnectionsPage from './pages/ConnectionsPage';
import MappingPage from './pages/MappingPage';
import ProvisionPage from './pages/ProvisionPage';
import ReviewDashboard from './pages/ReviewDashboard';

function App() {
  const { isAuthenticated, logout } = useStore();
  if (!isAuthenticated) return <LoginPage />;

  const [currentRoute, setCurrentRoute] = React.useState('/');

  const navigate = (path: string) => setCurrentRoute(path);

  const NavLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
    <button
      onClick={() => navigate(to)}
      className={`w-full text-left px-4 py-2 text-sm rounded-lg transition ${
        currentRoute === to ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >{children}</button>
  );

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col">
        <div className="mb-8"><h1 className="text-xl font-bold text-brand-600">TaxPro</h1></div>
        <nav className="flex flex-col gap-1 flex-1">
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/connections">Data Sources</NavLink>
          <NavLink to="/mapping">Tax Mapping</NavLink>
          <NavLink to="/provision">Provision</NavLink>
          <NavLink to="/review">Review</NavLink>
        </nav>
        <button onClick={logout} className="text-sm text-red-600 hover:text-red-800 text-left py-2">Logout</button>
      </aside>
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
