import { Link } from 'react-router';
import { useAuthStore } from '../store/auth';

export function LandingPage() {
  const { user } = useAuthStore();

  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-400 mb-6">
        <span>⚡ Real-Time Competitive Programming</span>
      </div>

      <h1 className="max-w-4xl text-5xl font-extrabold tracking-tight text-white sm:text-6xl md:text-7xl">
        Head-to-head coding. <br />
        <span className="bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400 bg-clip-text text-transparent">
          Live Codeforces duels.
        </span>
      </h1>

      <p className="mt-6 max-w-2xl text-lg text-slate-400">
        Queue up for your rating sheet, face a real opponent one problem at a time, solve directly
        on Codeforces in another tab, and watch live scores tick down as you race against the clock.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        {user ? (
          <Link
            to={user.handle ? '/play' : '/link-handle'}
            className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all"
          >
            {user.handle ? 'Enter Arena' : 'Link Codeforces Handle'}
          </Link>
        ) : (
          <>
            <Link
              to="/register"
              className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all"
            >
              Start Duelling
            </Link>
            <Link
              to="/login"
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-800 transition-all"
            >
              Log In
            </Link>
          </>
        )}
      </div>

      <div className="mt-20 grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3 text-left">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400 font-bold mb-4">
            01
          </div>
          <h3 className="text-lg font-semibold text-white">1v1 Rating Matchmaking</h3>
          <p className="mt-2 text-sm text-slate-400">
            Automated matchmaking with dynamic rating windows matching you with players in your
            difficulty sheet.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 font-bold mb-4">
            02
          </div>
          <h3 className="text-lg font-semibold text-white">Live Submission Detection</h3>
          <p className="mt-2 text-sm text-slate-400">
            Submit on Codeforces as usual. Duel detects your verdicts in seconds via real-time
            public status polling.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400 font-bold mb-4">
            03
          </div>
          <h3 className="text-lg font-semibold text-white">Decaying Score & Elo</h3>
          <p className="mt-2 text-sm text-slate-400">
            Points decay linearly over time with wrong attempt penalties and first-solve bonuses.
            Win duels to climb the leaderboard.
          </p>
        </div>
      </div>
    </div>
  );
}
