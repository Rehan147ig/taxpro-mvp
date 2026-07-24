import { create } from 'zustand';
import { apiClient } from '../api/client';

interface ProvisionState {
  isAuthenticated: boolean;
  tenant: { id: string; name: string; slug: string } | null;
  token: string | null;

  // Actions
  setAuth: (token: string, tenant: { id: string; name: string; slug: string }) => void;
  logout: () => void;
}

export const useStore = create<ProvisionState>((set) => ({
  isAuthenticated: !!localStorage.getItem('taxpro_token'),
  tenant: null,
  token: localStorage.getItem('taxpro_token'),

  setAuth: (token, tenant) => {
    localStorage.setItem('taxpro_token', token);
    set({ isAuthenticated: true, token, tenant });
  },

  logout: () => {
    localStorage.removeItem('taxpro_token');
    set({ isAuthenticated: false, token: null, tenant: null });
  },
}));
