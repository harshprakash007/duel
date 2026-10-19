import { Link, useNavigate } from 'react-router';
import { useAuthStore } from '../store/auth';
import { useSocketStore } from '../store/socket';
import { useSoundStore } from '../store/sound';

export function Navbar() {
  const { user, logout } = useAuthStore();
  const { activeMatch } = useSocketStore();
  const { soundEnabled, toggleSound } = useSoundStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const isMatchActive =
    activeMatch && activeMatch.status !== 'FINISHED' && activeMatch.status !== 'ABORTED';

  return (
    <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-black text-white shadow-lg shadow-indigo-600/30">
              ⚔
            </span>
            <span className="text-xl font-bold tracking-tight text-white">Duel</span>
          </Link>

          <nav className="hidden sm:flex items-center gap-4 text-sm font-semibold">
            <Link to="/play" className="text-slate-300 hover:text-white transition-colors">
              Play
            </Link>
            <Link to="/leaderboard" className="text-slate-300 hover:text-white transition-colors">
              Leaderboard
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 text-sm font-medium">
          {/* Active Match Return Pill */}
          {isMatchActive && (
            <Link
              to={`/match/${activeMatch.matchId}`}
              className="flex items-center gap-1.5 rounded-full border border-rose-500/50 bg-rose-500/20 px-3 py-1 text-xs font-bold text-rose-300 animate-pulse hover:bg-rose-500/30 transition-colors"
            >
              <span>⚡</span>
              <span>Match Active</span>
            </Link>
          )}

          {/* Sound Toggle Button */}
          <button
            onClick={toggleSound}
            title={soundEnabled ? 'Mute Sounds' : 'Enable Sounds'}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-800/80 text-sm hover:border-slate-700 transition-colors"
          >
            {soundEnabled ? '🔊' : '🔇'}
          </button>

          {user ? (
            <>
              {user.handle ? (
                <Link
                  to={`/users/${user.handle.handle}`}
                  className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 hover:border-indigo-500/50 transition-colors"
                >
                  <span className="text-xs text-slate-400">CF:</span>
                  <span className="font-semibold text-emerald-400">{user.handle.handle}</span>
                  {user.handle.rating !== null && user.handle.rating !== undefined && (
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs font-mono font-bold text-amber-300">
                      {user.handle.rating}
                    </span>
                  )}
                </Link>
              ) : (
                <Link
                  to="/link-handle"
                  className="rounded-md bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/30 border border-amber-500/30"
                >
                  Link Handle
                </Link>
              )}
              <button
                onClick={handleLogout}
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-slate-300 hover:text-white transition-colors">
                Log in
              </Link>
              <Link
                to="/register"
                className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-white hover:bg-indigo-500 transition-colors shadow-sm shadow-indigo-600/40"
              >
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
