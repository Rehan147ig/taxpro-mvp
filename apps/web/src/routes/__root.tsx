import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useStore } from '../stores/provision.store';

function Root() {
  const { isAuthenticated, logout } = useStore();

  if (!isAuthenticated) {
    return <Outlet />;
  }

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const NavLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
      className={`block px-4 py-2 text-sm rounded-lg transition ${
        window.location.pathname === to
          ? 'bg-brand-600 text-white'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </a>
  );

  return (
    <div className="min-h-screen flex">
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

      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function ErrorBoundary({ error }: { error: Error }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-red-50">
      <div className="bg-white rounded-xl border border-red-200 p-8 max-w-md text-center">
        <h2 className="text-xl font-bold text-red-700 mb-2">Something went wrong</h2>
        <p className="text-sm text-red-600 mb-4">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: Root,
  errorComponent: ErrorBoundary,
});
