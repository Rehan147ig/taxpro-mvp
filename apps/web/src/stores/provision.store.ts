import { create } from 'zustand';

interface ProvisionState {
  isAuthenticated: boolean;
  tenant: { id: string; name: string; slug: string } | null;
  token: string | null;

  // Actions
  setAuth: (token: string, tenant: { id: string; name: string; slug: string }) => void;
  logout: () => void;
}

// In local dev/demo mode, default to authenticated to open Dashboard directly
const initialToken = localStorage.getItem('taxpro_token') || 'demo_token';

export const useStore = create<ProvisionState>((set) => ({
  isAuthenticated: true,
  tenant: { id: '00000000-0000-4000-a000-000000000001', name: 'TaxPro Demo Enterprise', slug: 'demo-enterprise' },
  token: initialToken,

  setAuth: (token, tenant) => {
    localStorage.setItem('taxpro_token', token);
    set({ isAuthenticated: true, token, tenant });
  },

  logout: () => {
    localStorage.removeItem('taxpro_token');
    set({ isAuthenticated: false, token: null, tenant: null });
  },
}));
