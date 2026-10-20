import { Link } from 'react-router';
import { useAuthStore } from '../store/auth';
import { Swords, Zap, Activity, ShieldCheck, Trophy, ArrowRight, Terminal } from 'lucide-react';

export function LandingPage() {
  const { user } = useAuthStore();

  return (
    <div className="relative overflow-hidden px-4 py-16 sm:py-24 max-w-7xl mx-auto flex flex-col items-center">
      {/* Decorative Neon Blurs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-cyan-500/10 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute top-1/3 left-1/3 -translate-x-1/2 w-[400px] h-[300px] bg-violet-600/10 blur-[140px] pointer-events-none rounded-full" />

      {/* Hero Badge */}
      <div className="relative inline-flex items-center gap-2.5 rounded-full border border-cyan-500/30 bg-cyan-950/30 px-4 py-1.5 text-xs font-mono font-medium text-cyan-300 mb-8 backdrop-blur-md shadow-[0_0_15px_rgba(6,182,212,0.15)]">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
        </span>
        <span className="tracking-wider uppercase">Live 1v1 Competitive Arena</span>
      </div>

      {/* Main Headline */}
      <h1 className="max-w-4xl text-center text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-tight sm:leading-none">
        HEAD-TO-HEAD CODING. <br />
        <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-violet-400 bg-clip-text text-transparent neon-text-cyan">
          REAL-TIME DUELS.
        </span>
      </h1>

      <p className="mt-6 max-w-2xl text-center text-base sm:text-lg text-slate-400 font-normal leading-relaxed">
        Queue for your rating sheet, face an evenly-matched opponent, solve directly on Codeforces,
        and race against time as dynamic scores decay every second.
      </p>

      {/* CTA Buttons */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-4 z-10">
        {user ? (
          <Link
            to={user.handle ? '/play' : '/link-handle'}
            className="group relative inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-8 py-3.5 text-sm font-bold text-white shadow-[0_0_25px_rgba(6,182,212,0.4)] hover:shadow-[0_0_35px_rgba(6,182,212,0.6)] hover:from-cyan-400 hover:to-blue-500 transition-all tracking-wider font-mono uppercase"
          >
            <Swords className="w-4 h-4 group-hover:rotate-12 transition-transform" />
            <span>{user.handle ? 'Enter Arena' : 'Link Codeforces Handle'}</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </Link>
        ) : (
          <>
            <Link
              to="/register"
              className="group relative inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-8 py-3.5 text-sm font-bold text-white shadow-[0_0_25px_rgba(6,182,212,0.4)] hover:shadow-[0_0_35px_rgba(6,182,212,0.6)] hover:from-cyan-400 hover:to-blue-500 transition-all tracking-wider font-mono uppercase"
            >
              <Swords className="w-4 h-4 group-hover:rotate-12 transition-transform" />
              <span>Start Dueling</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/leaderboard"
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-slate-900/60 px-6 py-3.5 text-sm font-medium text-slate-300 hover:text-white hover:border-cyan-500/50 hover:bg-slate-900 transition-all backdrop-blur-md"
            >
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>Leaderboards</span>
            </Link>
          </>
        )}
      </div>

      {/* Interactive Cyber HUD Mockup */}
      <div className="mt-16 w-full max-w-4xl relative">
        <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-cyan-500/30 via-violet-600/30 to-blue-500/30 blur-xl opacity-60" />
        <div className="relative rounded-2xl border border-cyan-500/30 bg-[#060b17]/90 p-5 sm:p-7 backdrop-blur-xl shadow-2xl">
          {/* Mockup Header */}
          <div className="flex items-center justify-between border-b border-cyan-500/15 pb-4 mb-5">
            <div className="flex items-center gap-3">
              <span className="flex h-3 w-3 rounded-full bg-red-500/80" />
              <span className="flex h-3 w-3 rounded-full bg-yellow-500/80" />
              <span className="flex h-3 w-3 rounded-full bg-emerald-500/80" />
              <span className="ml-2 font-mono text-xs text-slate-500 tracking-widest uppercase">
                ARENA HUD // MATCH #4092
              </span>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-1 rounded-full">
              <Activity className="w-3.5 h-3.5 animate-pulse" />
              <span>TELEMETRY ACTIVE</span>
            </div>
          </div>

          {/* Duel Competitors HUD */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
            {/* Player A */}
            <div className="rounded-xl border border-cyan-500/30 bg-slate-900/80 p-4 relative overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-cyan-300 font-mono">tourist</span>
                <span className="text-xs font-mono text-slate-400">1840 Elo</span>
              </div>
              <div className="text-2xl font-extrabold text-white font-mono">
                1,840 <span className="text-xs text-slate-400 font-normal">pts</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                Q1 Accepted (03:42)
              </div>
            </div>

            {/* VS Badge & Timer */}
            <div className="flex flex-col items-center justify-center text-center py-2">
              <div className="font-mono text-xs text-slate-400 uppercase tracking-widest mb-1">
                TIME REMAINING
              </div>
              <div className="text-3xl font-black font-mono text-cyan-400 neon-text-cyan tracking-wider">
                11:28
              </div>
              <div className="mt-1 px-3 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-[11px] font-mono text-cyan-300">
                Question 2 of 3
              </div>
            </div>

            {/* Player B */}
            <div className="rounded-xl border border-violet-500/30 bg-slate-900/80 p-4 relative overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-violet-300 font-mono">Petr</span>
                <span className="text-xs font-mono text-slate-400">1815 Elo</span>
              </div>
              <div className="text-2xl font-extrabold text-white font-mono">
                1,720 <span className="text-xs text-slate-400 font-normal">pts</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-cyan-400 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                Testing Submission...
              </div>
            </div>
          </div>

          {/* Current Question Bar */}
          <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-2 text-slate-300">
              <Terminal className="w-4 h-4 text-cyan-400" />
              <span className="text-slate-400">CURRENT TARGET:</span>
              <span className="text-white font-bold">1850B - Ten Words of Wisdom</span>
              <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded text-[10px]">
                1200
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">CURRENT VALUE:</span>
              <span className="text-cyan-300 font-bold text-sm">745 PTS</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cyber Feature Cards */}
      <div className="mt-24 grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-3 text-left w-full">
        {/* Feature 1 */}
        <div className="neon-card rounded-2xl p-7 relative overflow-hidden group">
          <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 mb-5 group-hover:scale-110 transition-transform">
            <Activity className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-white tracking-wide">Autonomous Polling</h3>
          <p className="mt-2.5 text-sm text-slate-400 leading-relaxed">
            Submit directly on Codeforces as usual. Duel scrapes and validates public submissions in
            real time with zero password or credential sharing.
          </p>
        </div>

        {/* Feature 2 */}
        <div className="neon-card rounded-2xl p-7 relative overflow-hidden group">
          <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/30 text-violet-400 mb-5 group-hover:scale-110 transition-transform">
            <Zap className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-white tracking-wide">Decaying Time Scoring</h3>
          <p className="mt-2.5 text-sm text-slate-400 leading-relaxed">
            Every problem starts at 1,000 points and ticks down to 150 points. Claim a +100 point
            first-solve bonus, but beware of -50 point penalty deductions.
          </p>
        </div>

        {/* Feature 3 */}
        <div className="neon-card rounded-2xl p-7 relative overflow-hidden group">
          <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mb-5 group-hover:scale-110 transition-transform">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-white tracking-wide">Authoritative Elo</h3>
          <p className="mt-2.5 text-sm text-slate-400 leading-relaxed">
            Standard logistic Elo ratings with provisional scaling ($K=40$), anti-farming decay for
            repeat pairings, and verified Codeforces handle binding.
          </p>
        </div>
      </div>
    </div>
  );
}
