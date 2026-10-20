import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiFetch, ApiError } from '../api/client';
import { useAuthStore } from '../store/auth';
import { Swords, Lock, Mail, ArrowRight } from 'lucide-react';
import type { UserDto } from '@duel/shared';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { setUser } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch<{ user: UserDto }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setUser(res.user);
      if (res.user.handle) {
        navigate('/play');
      } else {
        navigate('/link-handle');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Login failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12 font-mono">
      <div className="w-full max-w-md rounded-3xl border border-cyan-500/30 bg-[#060b17]/90 p-8 shadow-[0_0_35px_rgba(6,182,212,0.2)] backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-400">
            <Swords className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white tracking-wider">DUELIST AUTHENTICATION</h2>
            <p className="text-xs text-slate-400 mt-0.5">Enter credentials to access the arena.</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3.5 text-xs text-rose-300">
            [ERROR] {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
              Email Address
            </label>
            <div className="relative">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-cyan-500/30 bg-slate-950 px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(6,182,212,0.3)] focus:outline-none"
                placeholder="you@example.com"
              />
              <Mail className="absolute right-3.5 top-3 w-4 h-4 text-slate-600 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-cyan-500/30 bg-slate-950 px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(6,182,212,0.3)] focus:outline-none"
                placeholder="••••••••"
              />
              <Lock className="absolute right-3.5 top-3 w-4 h-4 text-slate-600 pointer-events-none" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 text-xs font-bold text-white shadow-[0_0_20px_rgba(6,182,212,0.35)] hover:from-cyan-400 hover:to-blue-500 hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] disabled:opacity-50 transition-all uppercase tracking-wider mt-2 flex items-center justify-center gap-2"
          >
            <span>{loading ? 'Authenticating...' : 'Sign In To Arena'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Need an account?{' '}
          <Link to="/register" className="font-bold text-cyan-400 hover:underline">
            Register Here
          </Link>
        </p>
      </div>
    </div>
  );
}
