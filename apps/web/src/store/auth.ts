import { create } from 'zustand';
import type { UserDto } from '@duel/shared';
import { apiFetch } from '../api/client';

interface AuthState {
  user: UserDto | null;
  isLoading: boolean;
  initialized: boolean;
  fetchUser: () => Promise<UserDto | null>;
  setUser: (user: UserDto | null) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  initialized: false,

  fetchUser: async () => {
    set({ isLoading: true });
    try {
      const res = await apiFetch<{ user: UserDto }>('/api/auth/me');
      set({ user: res.user, isLoading: false, initialized: true });
      return res.user;
    } catch {
      set({ user: null, isLoading: false, initialized: true });
      return null;
    }
  },

  setUser: (user) => set({ user, initialized: true }),

  logout: async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      set({ user: null });
    }
  },
}));
