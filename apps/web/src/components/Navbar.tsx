import { Link, useNavigate, useLocation } from 'react-router';
import { useAuthStore } from '../store/auth';
import { useSocketStore } from '../store/socket';
import { useSoundStore } from '../store/sound';
import { Swords, Volume2, VolumeX, Shield, Zap, User } from 'lucide-react';

export function Navbar() {
  const { user, logout } = useAuthStore();
  const { activeMatch } = useSocketStore();
  const { soundEnabled, toggleSound } = useSoundStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const isMatchActive =
    activeMatch && activeMatch.status !== 'FINISHED' && activeMatch.status !== 'ABORTED';

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="border-b border-cyan-500/20 bg-[#030712]/85 backdrop-blur-xl sticky top-0 z-50">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Brand & Main Navigation */}
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 p-[1px] shadow-[0_0_15px_rgba(6,182,212,0.4)] group-hover:shadow-[0_0_20px_rgba(6,182,212,0.6)] transition-all">
              <div className="flex h-full w-full items-center justify-center rounded-lg bg-[#030712]">
                <Swords className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform" />
              </div>
            </div>
            <span className="text-xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-sky-300 to-violet-400 bg-clip-text text-transparent font-mono">
              DUEL
            </span>
          </Link>

          <nav className="hidden sm:flex items-center gap-1 text-sm font-medium">
            <Link
              to="/play"
              className={`px-3 py-1.5 rounded-md transition-all ${
                isActive('/play')
                  ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                  : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-900/60'
              }`}
            >
              Arena
            </Link>
            <Link
              to="/leaderboard"
              className={`px-3 py-1.5 rounded-md transition-all ${
                isActive('/leaderboard')
                  ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                  : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-900/60'
              }`}
            >
              Leaderboard
            </Link>
            {user?.role === 'ADMIN' && (
              <Link
                to="/admin"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold transition-all ${
                  isActive('/admin')
                    ? 'text-violet-400 bg-violet-500/10 border border-violet-500/30 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                    : 'text-violet-400 hover:text-violet-300 hover:bg-violet-950/40'
                }`}
              >
                <Shield className="w-3.5 h-3.5 text-violet-400" />
                Admin
              </Link>
            )}
          </nav>
        </div>

        {/* Right Section: Match Pill, Sound, Profile, Auth */}
        <div className="flex items-center gap-3 text-sm">
          {/* Active Match Return Pill */}
          {isMatchActive && (
            <Link
              to={`/match/${activeMatch.matchId}`}
              className="flex items-center gap-1.5 rounded-full border border-rose-500/60 bg-rose-500/20 px-3 py-1 text-xs font-bold text-rose-300 shadow-[0_0_15px_rgba(244,63,94,0.4)] animate-pulse hover:bg-rose-500/30 transition-all font-mono"
            >
              <Zap className="w-3.5 h-3.5 text-rose-400 fill-rose-400" />
              <span>LIVE MATCH</span>
            </Link>
          )}

          {/* Sound Toggle Button */}
          <button
            onClick={toggleSound}
            title={soundEnabled ? 'Mute Audio Synthesizer' : 'Enable Audio Synthesizer'}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/20 bg-slate-900/60 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/50 hover:shadow-[0_0_10px_rgba(6,182,212,0.2)] transition-all"
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-cyan-400" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-500" />
            )}
          </button>

          {user ? (
            <div className="flex items-center gap-2">
              {user.handle ? (
                <Link
                  to={`/u/${user.handle.handle}`}
                  className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/20 px-3 py-1 text-xs hover:border-emerald-500/60 hover:shadow-[0_0_12px_rgba(16,185,129,0.3)] transition-all"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981] animate-pulse"></span>
                  <span className="font-semibold text-emerald-300 font-mono">
                    {user.handle.handle}
                  </span>
                  {user.handle.rating !== null && user.handle.rating !== undefined && (
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-400 border border-amber-500/30">
                      {user.handle.rating}
                    </span>
                  )}
                </Link>
              ) : (
                <Link
                  to="/link-handle"
                  className="rounded-md bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 border border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.2)] transition-all"
                >
                  Link Handle
                </Link>
              )}

              <Link
                to={user.handle ? `/u/${user.handle.handle}` : '#'}
                title="Profile"
                className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200 transition-colors"
              >
                <User className="w-4 h-4" />
              </Link>

              <button
                onClick={handleLogout}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors ml-1"
              >
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors"
              >
                Log In
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)] hover:from-cyan-400 hover:to-blue-500 transition-all tracking-wide"
              >
                Enter Arena
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
