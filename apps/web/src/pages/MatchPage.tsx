import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Flag, ExternalLink, Zap, AlertOctagon, CheckCircle2, XCircle } from 'lucide-react';
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
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [reportReason, setReportReason] = useState<string>('');
  const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSuccess, setReportSuccess] = useState<boolean>(false);

  // Restore active match if page refreshed
  useEffect(() => {
    async function loadMatch() {
      if (activeMatch && activeMatch.matchId === routeMatchId) return;

      try {
        const res = await apiFetch<{ match: MatchStateSnapshot | null }>('/api/me/active-match');
        if (res.match && res.match.matchId === routeMatchId) {
          setActiveMatch(res.match);
        } else {
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
    } finally {
      setIsResigning(false);
      setShowResignModal(false);
    }
  };

  const handleSubmitReport = async () => {
    if (!activeMatch || reportReason.trim().length < 5) return;
    setIsSubmittingReport(true);
    setReportError(null);
    try {
      await apiFetch(`/api/matches/${activeMatch.matchId}/report`, {
        method: 'POST',
        body: JSON.stringify({
          category: 'CHEATING',
          comment: reportReason.trim(),
        }),
      });
      setReportSuccess(true);
      setTimeout(() => {
        setShowReportModal(false);
        setReportReason('');
        setReportSuccess(false);
      }, 1500);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setIsSubmittingReport(false);
    }
  };

  if (!activeMatch) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-sm font-mono text-cyan-400">
        <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-950/40 border border-cyan-500/40 mb-4">
          <Zap className="w-6 h-6 animate-pulse" />
        </div>
        <span>INITIALIZING ARENA TELEMETRY...</span>
      </div>
    );
  }

  // Derive my player and opponent player
  const playersList = Object.values(activeMatch.players);
  const myPlayer = playersList.find((p) => p.userId === user?.id);
  const oppPlayer = playersList.find((p) => p.userId !== user?.id);
  const problem = activeMatch.currentProblem;
  const isCountdown = activeMatch.status === 'COUNTDOWN';
  const isBreak = Boolean(activeMatch.breakDeadlineMs);

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Codeforces Outage Warning Banner */}
      {cfDegraded && (
        <div className="mb-6 rounded-2xl border border-amber-500/60 bg-amber-950/30 p-4 text-center backdrop-blur-md shadow-[0_0_20px_rgba(245,158,11,0.2)]">
          <span className="font-mono font-bold text-amber-300 flex items-center justify-center gap-2">
            <AlertOctagon className="w-4 h-4" />
            CODEFORCES API DEGRADATION DETECTED
          </span>
          <p className="text-xs text-slate-300 mt-1 font-mono">
            Timers are frozen. Matches will resume automatically when Codeforces recovers.
          </p>
        </div>
      )}

      {/* Top HUD: Match Info & Authoritative Timer */}
      <div className="mb-6 rounded-2xl border border-cyan-500/30 bg-[#060b17]/90 p-4 sm:p-6 backdrop-blur-xl flex flex-wrap items-center justify-between gap-4 shadow-[0_0_25px_rgba(6,182,212,0.15)]">
        <div>
          <span className="text-[11px] uppercase tracking-widest font-mono font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-2.5 py-0.5 rounded-full">
            {activeMatch.mode === 'RANKED' ? 'RANKED 1v1 DUEL' : 'PRIVATE CUSTOM ARENA'}
          </span>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white mt-1.5 font-mono">
            Question {(activeMatch.currentQuestionIdx ?? 0) + 1} of {activeMatch.questionCount}
          </h2>
        </div>

        {/* Big Authoritative Timer */}
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="text-center">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-mono block">
              {isCountdown ? 'STARTING IN' : isBreak ? 'BREAK ENDING' : 'ROUND TIME'}
            </span>
            <div
              className={`font-mono text-3xl sm:text-4xl font-black tracking-wider ${
                remainingSec <= 20
                  ? 'text-rose-400 neon-text-rose animate-pulse'
                  : remainingSec <= 60
                    ? 'text-amber-400 neon-text-amber'
                    : 'text-cyan-400 neon-text-cyan'
              }`}
            >
              {formatTimer(remainingSec)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowReportModal(true)}
              className="rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-xs font-mono font-bold text-slate-400 hover:text-white hover:border-slate-500 transition-all flex items-center gap-1.5"
              title="Report Match"
            >
              <Flag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">REPORT</span>
            </button>
            <button
              onClick={() => setShowResignModal(true)}
              className="rounded-xl border border-rose-500/40 bg-rose-950/20 px-3.5 py-2 text-xs font-mono font-bold text-rose-300 hover:bg-rose-900/40 hover:border-rose-500/70 hover:shadow-[0_0_15px_rgba(244,63,94,0.3)] transition-all uppercase"
            >
              Resign
            </button>
          </div>
        </div>
      </div>

      {/* Main Arena Layout: Problem on Left, Competitors on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Problem Workspace */}
        <div className="lg:col-span-2 space-y-6">
          <div className="neon-card rounded-2xl p-6 sm:p-8">
            {problem ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-cyan-950/80 border border-cyan-500/50 px-3 py-1 text-sm font-mono font-extrabold text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                      {problem.contestId}
                      {problem.index}
                    </span>
                    <h3 className="text-xl sm:text-2xl font-bold text-white tracking-wide">
                      {problem.name}
                    </h3>
                  </div>
                  <span className="rounded-full bg-amber-500/10 border border-amber-500/40 px-3 py-1 text-xs font-mono font-bold text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
                    Rating {problem.rating}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {problem.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-md bg-slate-900/80 border border-slate-800 px-2.5 py-0.5 text-xs font-mono text-slate-400"
                    >
                      #{t}
                    </span>
                  ))}
                </div>

                {/* Problem Action Card */}
                <div className="mt-8 rounded-2xl border border-cyan-500/30 bg-[#051120]/80 p-6 sm:p-8 text-center space-y-4">
                  <p className="text-sm text-slate-300 max-w-md mx-auto">
                    Solve this question on Codeforces in another tab. Our poller tracks your public
                    verdict in real time.
                  </p>
                  <a
                    href={problem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-7 py-3.5 font-mono text-xs font-extrabold uppercase tracking-wider text-white hover:from-cyan-400 hover:to-blue-500 shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all"
                  >
                    <span>Open On Codeforces</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>

                {/* Instant Submission Check Hint Action */}
                <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4 font-mono">
                  <div>
                    <span className="text-xs font-bold text-emerald-300 uppercase tracking-wide">
                      Just Submitted Your Solution?
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Request an immediate high-priority verdict scan without waiting for the cycle.
                    </p>
                  </div>
                  <button
                    onClick={handleSubmittedHint}
                    disabled={hintCooldown > 0}
                    className="w-full sm:w-auto rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-emerald-500 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50 shrink-0"
                  >
                    {hintCooldown > 0 ? `Scanning (${hintCooldown}s)` : 'I Submitted!'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center text-slate-500 text-sm font-mono">
                <span className="animate-pulse">WAITING FOR QUESTION START...</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Scoreboard HUD */}
        <div className="space-y-4 font-mono">
          <div className="flex items-center justify-between text-xs text-slate-400 font-bold uppercase tracking-widest px-1">
            <span>Scoreboard</span>
            <span className="text-cyan-400">LIVE FEED</span>
          </div>

          {/* Current User Card */}
          {myPlayer && (
            <div
              className={`rounded-2xl border p-5 transition-all relative overflow-hidden ${
                myPlayer.solvedCurrent
                  ? 'border-emerald-500/60 bg-emerald-950/30 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
                  : 'border-cyan-500/30 bg-[#060b17]/90 shadow-[0_0_15px_rgba(6,182,212,0.1)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold">
                    YOU
                  </span>
                  <div className="text-lg font-bold text-white">{myPlayer.handle}</div>
                  <span className="text-xs text-slate-400">{myPlayer.rating} Elo</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Score</span>
                  <div className="text-3xl font-extrabold text-white neon-text-cyan">
                    {myPlayer.score}
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-800/80 pt-3 flex items-center justify-between text-xs">
                <span>
                  {myPlayer.solvedCurrent ? (
                    <span className="font-semibold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Solved
                    </span>
                  ) : (
                    <span className="text-cyan-300 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse"></span>
                      Solving...
                    </span>
                  )}
                </span>
                {myPlayer.wrongAttemptsCurrent > 0 && (
                  <span className="text-rose-400 font-semibold flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" />
                    {myPlayer.wrongAttemptsCurrent} penalty
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Opponent Card */}
          {oppPlayer && (
            <div
              className={`rounded-2xl border p-5 transition-all relative overflow-hidden ${
                oppPlayer.solvedCurrent
                  ? 'border-emerald-500/60 bg-emerald-950/30 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
                  : 'border-violet-500/30 bg-[#060b17]/90 shadow-[0_0_15px_rgba(168,85,247,0.1)]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-violet-400 uppercase tracking-widest font-bold">
                    OPPONENT
                  </span>
                  <div className="text-lg font-bold text-white">{oppPlayer.handle}</div>
                  <span className="text-xs text-slate-400">{oppPlayer.rating} Elo</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Score</span>
                  <div className="text-3xl font-extrabold text-white neon-text-violet">
                    {oppPlayer.score}
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-800/80 pt-3 flex items-center justify-between text-xs">
                <span>
                  {oppPlayer.solvedCurrent ? (
                    <span className="font-semibold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Solved
                    </span>
                  ) : (
                    <span className="text-violet-300 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse"></span>
                      Solving...
                    </span>
                  )}
                </span>
                {oppPlayer.wrongAttemptsCurrent > 0 && (
                  <span className="text-rose-400 font-semibold flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" />
                    {oppPlayer.wrongAttemptsCurrent} penalty
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 font-mono">
          <div className="w-full max-w-md rounded-2xl border border-cyan-500/40 bg-[#060e20] p-6 shadow-[0_0_35px_rgba(6,182,212,0.25)]">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Flag className="w-5 h-5 text-cyan-400" />
              REPORT SUSPICIOUS ACTIVITY
            </h3>
            <p className="mt-2 text-xs text-slate-400">
              Submit a report for administrator review (cheating, outside assistance, or
              harassment).
            </p>
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Describe the issue (minimum 5 characters)..."
              rows={4}
              className="mt-4 w-full rounded-xl border border-cyan-500/30 bg-slate-950 p-3 text-xs text-white placeholder-slate-600 focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(6,182,212,0.3)] focus:outline-none"
            />
            {reportError && <p className="mt-2 text-xs text-rose-400">{reportError}</p>}
            {reportSuccess && (
              <p className="mt-2 text-xs text-emerald-400">Report submitted successfully.</p>
            )}
            <div className="mt-6 flex justify-end gap-3 text-xs">
              <button
                onClick={() => {
                  setShowReportModal(false);
                  setReportReason('');
                  setReportError(null);
                  setReportSuccess(false);
                }}
                disabled={isSubmittingReport}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitReport}
                disabled={isSubmittingReport || reportReason.trim().length < 5 || reportSuccess}
                className="rounded-xl bg-cyan-600 px-5 py-2 font-bold text-white hover:bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)] disabled:opacity-50"
              >
                {isSubmittingReport ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resign Confirmation Modal */}
      {showResignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 font-mono">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-[#16060c] p-6 shadow-[0_0_35px_rgba(244,63,94,0.25)]">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <AlertOctagon className="w-5 h-5 text-rose-400" />
              CONFIRM FORFEIT / RESIGN
            </h3>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">
              Resigning immediately ends the duel and registers as a defeat. Your Elo will update
              accordingly.
            </p>
            <div className="mt-6 flex justify-end gap-3 text-xs">
              <button
                onClick={() => setShowResignModal(false)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 font-semibold text-slate-300 hover:bg-slate-800"
              >
                Stay In Duel
              </button>
              <button
                onClick={handleResign}
                disabled={isResigning}
                className="rounded-xl bg-rose-600 px-5 py-2 font-bold text-white hover:bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)] disabled:opacity-50"
              >
                {isResigning ? 'Resigning...' : 'Confirm Resign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Feed */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2 max-w-sm font-mono">
        {toasts.slice(-4).map((t) => (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            className={`cursor-pointer rounded-xl border p-3.5 text-xs shadow-xl backdrop-blur-md transition-all ${
              t.type === 'success'
                ? 'border-emerald-500/50 bg-emerald-950/90 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                : t.type === 'penalty'
                  ? 'border-rose-500/50 bg-rose-950/90 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                  : 'border-cyan-500/30 bg-[#060b17]/95 text-slate-200'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
