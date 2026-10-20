import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Flag, Trophy, Skull, Swords, ExternalLink, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { apiFetch } from '../api/client';
import type { MatchRecapDto } from '@duel/shared';

export function MatchRecapPage() {
  const { id: matchId } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [reportReason, setReportReason] = useState<string>('');
  const [isSubmittingReport, setIsSubmittingReport] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSuccess, setReportSuccess] = useState<boolean>(false);

  const {
    data: match,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['match-recap', matchId],
    queryFn: async () => {
      return await apiFetch<MatchRecapDto>(`/api/matches/${matchId}`);
    },
    enabled: Boolean(matchId),
  });

  const handleSubmitReport = async () => {
    if (!matchId) return;
    setIsSubmittingReport(true);
    setReportError(null);
    try {
      await apiFetch(`/api/matches/${matchId}/report`, {
        method: 'POST',
        body: JSON.stringify({ category: 'CHEATING', comment: reportReason.trim() }),
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

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center font-mono text-cyan-400 text-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent shadow-[0_0_15px_rgba(6,182,212,0.4)]" />
          <span>COMPILING DUEL TELEMETRY...</span>
        </div>
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center font-mono">
        <h2 className="text-2xl font-black text-white">DUEL NOT FOUND</h2>
        <p className="mt-2 text-xs text-slate-400">
          This match record could not be retrieved or has expired.
        </p>
        <Link
          to="/play"
          className="mt-6 inline-block rounded-xl bg-cyan-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.3)] uppercase tracking-wider"
        >
          Return to Arena
        </Link>
      </div>
    );
  }

  const myPlayer = match.players.find((p) => p.userId === user?.id);
  const oppPlayer = match.players.find((p) => p.userId !== user?.id);

  const isWinner = match.winnerUserId && user?.id && match.winnerUserId === user.id;
  const isLoser = match.winnerUserId && user?.id && match.winnerUserId !== user.id;
  const isDraw = !match.winnerUserId && match.status === 'FINISHED';
  const isAborted = match.status === 'ABORTED';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-8 font-mono">
      {/* Hero Outcome Banner */}
      <div
        className={`rounded-3xl border p-8 sm:p-12 text-center backdrop-blur-xl relative overflow-hidden ${
          isWinner
            ? 'border-emerald-500/60 bg-[#051c14]/90 shadow-[0_0_40px_rgba(16,185,129,0.25)]'
            : isLoser
              ? 'border-rose-500/60 bg-[#1f070e]/90 shadow-[0_0_40px_rgba(244,63,94,0.25)]'
              : isAborted
                ? 'border-slate-700 bg-slate-900/60'
                : 'border-cyan-500/50 bg-[#061226]/90 shadow-[0_0_40px_rgba(6,182,212,0.2)]'
        }`}
      >
        <div className="flex items-center justify-center gap-2 mb-2">
          {isWinner && <Trophy className="w-8 h-8 text-emerald-400 animate-bounce" />}
          {isLoser && <Skull className="w-8 h-8 text-rose-400" />}
          {isDraw && <Swords className="w-8 h-8 text-cyan-400" />}
        </div>

        <span className="text-[11px] uppercase tracking-widest font-extrabold text-slate-400 block">
          MATCH RECAP // {match.sheet.name}
        </span>

        <h1
          className={`text-4xl sm:text-6xl font-black mt-2 tracking-wider ${
            isWinner
              ? 'text-emerald-400 neon-text-emerald'
              : isLoser
                ? 'text-rose-400 neon-text-rose'
                : isAborted
                  ? 'text-slate-400'
                  : 'text-cyan-400 neon-text-cyan'
          }`}
        >
          {isWinner
            ? 'VICTORY'
            : isLoser
              ? 'DEFEAT'
              : isAborted
                ? 'MATCH ABORTED'
                : isDraw
                  ? 'DRAW'
                  : 'MATCH FINISHED'}
        </h1>

        {match.endReason && (
          <p className="text-xs text-slate-400 mt-2 uppercase tracking-wide">
            CONCLUSION: {match.endReason.toLowerCase().replace(/_/g, ' ')}
          </p>
        )}

        {/* Dual Competitors Score Display */}
        <div className="mt-8 flex items-center justify-center gap-8 sm:gap-20">
          <div className="text-center">
            <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider block">
              {myPlayer?.handle ?? match.players[0]?.handle ?? 'Player 1'}
            </span>
            <div className="text-4xl sm:text-6xl font-black text-white mt-1 neon-text-cyan">
              {myPlayer?.score ?? match.players[0]?.score ?? 0}
            </div>
            {myPlayer?.delta !== null && myPlayer?.delta !== undefined && (
              <span
                className={`mt-2 inline-block rounded-full px-3 py-0.5 text-xs font-bold border ${
                  myPlayer.delta > 0
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                    : myPlayer.delta < 0
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {myPlayer.delta > 0 ? `+${myPlayer.delta}` : myPlayer.delta} Elo
              </span>
            )}
          </div>

          <div className="text-2xl sm:text-3xl font-black text-slate-700">VS</div>

          <div className="text-center">
            <span className="text-xs font-bold text-violet-300 uppercase tracking-wider block">
              {oppPlayer?.handle ?? match.players[1]?.handle ?? 'Player 2'}
            </span>
            <div className="text-4xl sm:text-6xl font-black text-white mt-1 neon-text-violet">
              {oppPlayer?.score ?? match.players[1]?.score ?? 0}
            </div>
            {oppPlayer?.delta !== null && oppPlayer?.delta !== undefined && (
              <span
                className={`mt-2 inline-block rounded-full px-3 py-0.5 text-xs font-bold border ${
                  oppPlayer.delta > 0
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                    : oppPlayer.delta < 0
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {oppPlayer.delta > 0 ? `+${oppPlayer.delta}` : oppPlayer.delta} Elo
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Question Breakdown Matrix */}
      <div className="neon-card rounded-2xl p-6 sm:p-8">
        <h2 className="text-lg font-bold text-white mb-5 uppercase tracking-wider flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
          <span>Question Telemetry Breakdown</span>
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-cyan-500/20 text-[11px] uppercase tracking-wider text-slate-400">
                <th className="py-3 px-4">#</th>
                <th className="py-3 px-4">Problem</th>
                <th className="py-3 px-4 text-center">Rating</th>
                <th className="py-3 px-4 text-right">
                  {myPlayer?.handle ?? match.players[0]?.handle ?? 'P1'}
                </th>
                <th className="py-3 px-4 text-right">
                  {oppPlayer?.handle ?? match.players[1]?.handle ?? 'P2'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {match.questions.map((q) => {
                const score1 = myPlayer
                  ? (q.scores[myPlayer.userId] ?? 0)
                  : match.players[0]
                    ? (q.scores[match.players[0].userId] ?? 0)
                    : 0;
                const score2 = oppPlayer
                  ? (q.scores[oppPlayer.userId] ?? 0)
                  : match.players[1]
                    ? (q.scores[match.players[1].userId] ?? 0)
                    : 0;

                const isP1First = myPlayer
                  ? q.firstSolveUserId === myPlayer.userId
                  : match.players[0] && q.firstSolveUserId === match.players[0].userId;
                const isP2First = oppPlayer
                  ? q.firstSolveUserId === oppPlayer.userId
                  : match.players[1] && q.firstSolveUserId === match.players[1].userId;

                return (
                  <tr key={q.idx} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-4 px-4 font-bold text-cyan-400">{q.idx + 1}</td>
                    <td className="py-4 px-4 font-medium text-white">
                      <a
                        href={q.problem.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-cyan-400 transition-colors inline-flex items-center gap-1.5"
                      >
                        <span className="text-cyan-300 font-bold">
                          {q.problem.contestId}
                          {q.problem.index}
                        </span>
                        <span className="text-slate-200">{q.problem.name}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                      </a>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[11px] text-amber-300 font-bold">
                        {q.problem.rating}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right font-bold text-white">
                      {score1 > 0 ? (
                        <span className="text-emerald-400">
                          +{score1} {isP1First && '★'}
                        </span>
                      ) : (
                        <span className="text-slate-600">0</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-right font-bold text-white">
                      {score2 > 0 ? (
                        <span className="text-emerald-400">
                          +{score2} {isP2First && '★'}
                        </span>
                      ) : (
                        <span className="text-slate-600">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/leaderboard"
            className="rounded-xl border border-cyan-500/30 bg-slate-900/80 px-5 py-2.5 text-xs font-bold text-slate-300 hover:text-white hover:border-cyan-500/60 transition-all uppercase"
          >
            View Leaderboard
          </Link>
          {user && (
            <button
              onClick={() => setShowReportModal(true)}
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-bold text-slate-400 hover:text-rose-300 hover:border-rose-500/50 transition-all flex items-center gap-1.5 uppercase"
            >
              <Flag className="w-3.5 h-3.5" />
              Report Match
            </button>
          )}
        </div>
        <Link
          to="/play"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-2.5 text-xs font-bold text-white hover:from-cyan-400 hover:to-blue-500 transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] uppercase tracking-wider"
        >
          <span>Play Another Duel</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-2xl border border-cyan-500/40 bg-[#060e20] p-6 shadow-[0_0_35px_rgba(6,182,212,0.25)]">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Flag className="w-5 h-5 text-cyan-400" />
              REPORT MATCH OUTCOME
            </h3>
            <p className="mt-2 text-xs text-slate-400">
              Submit concerns regarding unfair play, cheating, or exploited loopholes for admin
              review.
            </p>
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Provide context for moderation (minimum 5 characters)..."
              rows={4}
              className="mt-4 w-full rounded-xl border border-cyan-500/30 bg-slate-950 p-3 text-xs text-white placeholder-slate-600 focus:border-cyan-400 focus:outline-none"
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
    </div>
  );
}
