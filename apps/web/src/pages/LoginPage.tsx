import React, { useState } from 'react';
import { auth, setToken } from '../api/client';
import { useStore } from '../stores/provision.store';

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = isRegister
        ? await auth.register({ email, password, tenantName, tenantSlug })
        : await auth.login({ email, password });

      setToken(result.token);
      setAuth(result.token, result.tenant);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-taxpro-bg font-sans p-4">
      <div className="bg-white p-8 rounded-card border border-gray-200 shadow-sm w-full max-w-md">
        <h1 className="text-2xl font-serif font-semibold text-[#0A192F] mb-1 tracking-tight">
          TaxPro Enterprise
        </h1>
        <p className="text-xs text-gray-500 mb-6 font-sans">
          {isRegister ? 'Create your corporate account' : 'Sign in to your corporate tax workspace'}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-[#0A192F] mb-1">Email Address</label>
            <input
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2 border border-gray-300 rounded-button text-sm text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#0A192F] transition-all"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#0A192F] mb-1">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2 border border-gray-300 rounded-button text-sm text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#0A192F] transition-all"
              required
              minLength={8}
            />
          </div>

          {isRegister && (
            <>
              <div>
                <label className="block text-xs font-medium text-[#0A192F] mb-1">Company Name</label>
                <input
                  type="text"
                  placeholder="Acme Corporation"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-button text-sm text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#0A192F] transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#0A192F] mb-1">Company Slug</label>
                <input
                  type="text"
                  placeholder="acme-corp"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-button text-sm text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#0A192F] transition-all"
                  required
                  pattern="[a-z0-9-]+"
                />
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-button text-xs font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#0A192F] text-white py-2.5 rounded-button text-sm font-medium hover:bg-[#112240] disabled:opacity-50 transition-colors shadow-sm mt-1"
          >
            {loading ? 'Authenticating...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p className="text-xs text-gray-500 mt-6 text-center">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-[#0A192F] font-semibold hover:underline"
          >
            {isRegister ? 'Sign in' : 'Register'}
          </button>
        </p>
      </div>
    </div>
  );
}
