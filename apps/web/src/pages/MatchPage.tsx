import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useAuthStore } from '../store/auth';
import { useSocketStore } from '../store/socket';
import { apiFetch } from '../api/client';
import type { MatchStateSnapshot } from '@duel/shared';

export function MatchPage() {
  const { id: routeMatchId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    activeMatch,
    setActiveMatch,
    clockDriftMs,
    cfDegraded,
    toasts,
    removeToast,
    sendSubmissionHint,
    resignMatch,
  } = useSocketStore();

  const [remainingSec, setRemainingSec] = useState<number>(0);
  const [hintCooldown, setHintCooldown] = useState<number>(0);
  const [showResignModal, setShowResignModal] = useState<boolean>(false);
  const [isResigning, setIsResigning] = useState<boolean>(false);

  // Restore active match if page refreshed
  useEffect(() => {
    async function loadMatch() {
      if (activeMatch && activeMatch.matchId === routeMatchId) return;

      try {
        const res = await apiFetch<{ match: MatchStateSnapshot | null }>('/api/me/active-match');
        if (res.match && res.match.matchId === routeMatchId) {
          setActiveMatch(res.match);
        } else {
          // If match is finished or user not in active match, navigate to recap
          navigate(`/matches/${routeMatchId}`, { replace: true });
        }
      } catch {
        navigate(`/matches/${routeMatchId}`, { replace: true });
      }
    }
    void loadMatch();
  }, [routeMatchId, activeMatch, setActiveMatch, navigate]);

  // Navigate to recap when match completes or aborts
  useEffect(() => {
    if (activeMatch && (activeMatch.status === 'FINISHED' || activeMatch.status === 'ABORTED')) {
      navigate(`/matches/${activeMatch.matchId}`, { replace: true });
    }
  }, [activeMatch, navigate]);

  // Synchronized countdown timer tick
  useEffect(() => {
    if (!activeMatch) return;

    const interval = setInterval(() => {
      const now = Date.now() + clockDriftMs;
      let targetDeadlineMs = 0;

      if (activeMatch.status === 'COUNTDOWN' && activeMatch.countdownDeadlineMs) {
        targetDeadlineMs = activeMatch.countdownDeadlineMs;
      } else if (activeMatch.breakDeadlineMs) {
        targetDeadlineMs = activeMatch.breakDeadlineMs;
      } else if (activeMatch.status === 'ACTIVE' && activeMatch.questionDeadlineMs) {
        targetDeadlineMs = activeMatch.questionDeadlineMs;
      }

      if (targetDeadlineMs > 0) {
        const diffMs = Math.max(0, targetDeadlineMs - now);
        setRemainingSec(Math.ceil(diffMs / 1000));
      } else {
        setRemainingSec(0);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [activeMatch, clockDriftMs]);

  // Submission hint cooldown timer
  useEffect(() => {
    if (hintCooldown <= 0) return;
    const interval = setInterval(() => {
      setHintCooldown((cd) => Math.max(0, cd - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [hintCooldown]);

  const handleSubmittedHint = async () => {
    if (hintCooldown > 0) return;
    setHintCooldown(5);
    await sendSubmissionHint();
  };

  const handleResign = async () => {
    setIsResigning(true);
    try {
      await resignMatch();
      setShowResignModal(false);
    } finally {
      setIsResigning(false);
    }
  };

  if (!activeMatch) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <span className="text-sm text-slate-400">Loading duel arena...</span>
        </div>
      </div>
    );
  }

  const players = Object.values(activeMatch.players);
  const myPlayer = players.find((p) => p.userId === user?.id) ?? players[0];
  const oppPlayer = players.find((p) => p.userId !== user?.id) ?? players[1];

  const problem = activeMatch.currentProblem;
  const isCountdown = activeMatch.status === 'COUNTDOWN';
  const isBreak = Boolean(activeMatch.breakDeadlineMs);

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Codeforces Outage Warning Banner */}
      {cfDegraded && (
        <div className="mb-6 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-center">
          <span className="font-bold text-amber-400">Codeforces API Degradation Detected</span>
          <p className="text-xs text-slate-400 mt-1">
            Question timers are frozen. Match will resume automatically when Codeforces recovers.
          </p>
        </div>
      )}

      {/* Top Bar: Match Info & Countdown */}
      <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6 backdrop-blur flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs uppercase tracking-wider font-bold text-indigo-400">
            {activeMatch.mode === 'RANKED' ? 'Ranked Match' : 'Private Custom Match'}
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-white mt-0.5">
            Question {(activeMatch.currentQuestionIdx ?? 0) + 1} of {activeMatch.questionCount}
          </h2>
        </div>

        {/* Big Authoritative Timer */}
        <div className="flex items-center gap-4">
          <div className="text-center">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold block">
              {isCountdown ? 'Starting In' : isBreak ? 'Break Ending In' : 'Time Remaining'}
            </span>
            <div
              className={`font-mono text-3xl sm:text-4xl font-extrabold ${
                remainingSec <= 20
                  ? 'text-rose-500 animate-pulse'
                  : remainingSec <= 60
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              }`}
            >
              {formatTimer(remainingSec)}
            </div>
          </div>

          <button
            onClick={() => setShowResignModal(true)}
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors"
          >
            Resign
          </button>
        </div>
      </div>

      {/* Main Arena Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Problem Information */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur">
            {problem ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-indigo-600/20 border border-indigo-500/30 px-2.5 py-1 text-sm font-mono font-bold text-indigo-300">
                      {problem.contestId}
                      {problem.index}
                    </span>
                    <h3 className="text-xl font-bold text-white">{problem.name}</h3>
                  </div>
                  <span className="rounded-full bg-slate-800 border border-slate-700 px-3 py-1 text-xs font-bold text-amber-300">
                    Rating {problem.rating}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {problem.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-md bg-slate-800/80 px-2 py-0.5 text-xs text-slate-400"
                    >
                      {t}
                    </span>
                  ))}
                </div>

                {/* Prominent Solve Action Card */}
                <div className="mt-8 rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-6 text-center space-y-4">
                  <p className="text-sm text-slate-300">
                    Solve this problem on Codeforces. Our poller watches your public submissions in
                    real time.
                  </p>
                  <a
                    href={problem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 font-bold text-white hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-600/30"
                  >
                    <span>Open Problem on Codeforces</span>
                    <span>↗</span>
                  </a>
                </div>

                {/* "I Submitted" Hint Action */}
                <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
                  <div>
                    <span className="text-sm font-semibold text-white">Just submitted?</span>
                    <p className="text-xs text-slate-400">
                      Click to request an instant high-priority verdict check.
                    </p>
                  </div>
                  <button
                    onClick={handleSubmittedHint}
                    disabled={hintCooldown > 0}
                    className="w-full sm:w-auto rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
                  >
                    {hintCooldown > 0 ? `Checking... (${hintCooldown}s)` : 'I Submitted!'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center text-slate-500 text-sm">
                Waiting for question to start...
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Scoreboard */}
        <div className="space-y-4">
          <h3 className="text-sm uppercase tracking-wider font-bold text-slate-400">Scoreboard</h3>

          {/* Current User Card */}
          {myPlayer && (
            <div
              className={`rounded-2xl border p-5 transition-all ${
                myPlayer.solvedCurrent
                  ? 'border-emerald-500/50 bg-emerald-950/20 shadow-lg shadow-emerald-950/30'
                  : 'border-slate-800 bg-slate-900/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400">You</span>
                  <div className="text-lg font-bold text-white">{myPlayer.handle}</div>
                  <span className="text-xs text-indigo-400">Rating {myPlayer.rating}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Score</span>
                  <div className="text-3xl font-mono font-black text-white">{myPlayer.score}</div>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-800/80 pt-3 flex items-center justify-between text-xs">
                <span>
                  {myPlayer.solvedCurrent ? (
                    <span className="font-semibold text-emerald-400">✓ Solved</span>
                  ) : (
                    <span className="text-slate-400">Solving...</span>
                  )}
                </span>
                {myPlayer.wrongAttemptsCurrent > 0 && (
                  <span className="text-rose-400 font-semibold">
                    {myPlayer.wrongAttemptsCurrent} wrong attempts
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Opponent Card */}
          {oppPlayer && (
            <div
              className={`rounded-2xl border p-5 transition-all ${
                oppPlayer.solvedCurrent
                  ? 'border-emerald-500/50 bg-emerald-950/20 shadow-lg shadow-emerald-950/30'
                  : 'border-slate-800 bg-slate-900/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-400">Opponent</span>
                  <div className="text-lg font-bold text-white">{oppPlayer.handle}</div>
                  <span className="text-xs text-indigo-400">Rating {oppPlayer.rating}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400 uppercase font-semibold">Score</span>
                  <div className="text-3xl font-mono font-black text-white">{oppPlayer.score}</div>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-800/80 pt-3 flex items-center justify-between text-xs">
                <span>
                  {oppPlayer.solvedCurrent ? (
                    <span className="font-semibold text-emerald-400">✓ Solved</span>
                  ) : (
                    <span className="text-slate-400">Solving...</span>
                  )}
                </span>
                {oppPlayer.wrongAttemptsCurrent > 0 && (
                  <span className="text-rose-400 font-semibold">
                    {oppPlayer.wrongAttemptsCurrent} wrong attempts
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Resign Confirmation Modal */}
      {showResignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-white">Resign Match?</h3>
            <p className="mt-2 text-sm text-slate-400">
              Resigning immediately ends the duel and counts as a loss. Your rating will be
              calculated accordingly.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowResignModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
              >
                Continue Playing
              </button>
              <button
                onClick={handleResign}
                disabled={isResigning}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {isResigning ? 'Resigning...' : 'Confirm Resign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Feed */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 max-w-sm">
        {toasts.slice(-4).map((t) => (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            className={`cursor-pointer rounded-xl border p-3.5 text-xs shadow-lg backdrop-blur transition-all ${
              t.type === 'success'
                ? 'border-emerald-500/50 bg-emerald-950/80 text-emerald-200'
                : t.type === 'penalty'
                  ? 'border-rose-500/50 bg-rose-950/80 text-rose-200'
                  : 'border-slate-700 bg-slate-900/90 text-slate-200'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
