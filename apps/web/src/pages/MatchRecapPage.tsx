import { useParams, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { apiFetch } from '../api/client';
import type { MatchRecapDto } from '@duel/shared';

export function MatchRecapPage() {
  const { id: matchId } = useParams<{ id: string }>();
  const { user } = useAuthStore();

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

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <span className="text-sm text-slate-400">Loading match recap...</span>
        </div>
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-white">Match Not Found</h2>
        <p className="mt-2 text-sm text-slate-400">
          This match could not be found or you do not have permission to view it.
        </p>
        <Link
          to="/play"
          className="mt-6 inline-block rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-indigo-500"
        >
          Return to Lobby
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
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-8">
      {/* Hero Outcome Banner */}
      <div
        className={`rounded-3xl border p-8 text-center backdrop-blur shadow-2xl ${
          isWinner
            ? 'border-emerald-500/50 bg-emerald-950/30 shadow-emerald-950/40'
            : isLoser
              ? 'border-rose-500/50 bg-rose-950/30 shadow-rose-950/40'
              : isAborted
                ? 'border-slate-700 bg-slate-900/50'
                : 'border-amber-500/50 bg-amber-950/30'
        }`}
      >
        <span className="text-xs uppercase tracking-widest font-extrabold text-slate-400">
          Match Recap &middot; {match.sheet.name}
        </span>

        <h1 className="text-4xl sm:text-5xl font-black text-white mt-2">
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
          <p className="text-sm text-slate-400 mt-1 capitalize">
            Reason: {match.endReason.toLowerCase().replace(/_/g, ' ')}
          </p>
        )}

        {/* Big Dual Score Display */}
        <div className="mt-8 flex items-center justify-center gap-8 sm:gap-16">
          <div className="text-center">
            <span className="text-sm font-semibold text-slate-300 block">
              {myPlayer?.handle ?? match.players[0]?.handle ?? 'Player 1'}
            </span>
            <div className="text-4xl sm:text-5xl font-mono font-black text-white mt-1">
              {myPlayer?.score ?? match.players[0]?.score ?? 0}
            </div>
            {myPlayer?.delta !== null && myPlayer?.delta !== undefined && (
              <span
                className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  myPlayer.delta > 0
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : myPlayer.delta < 0
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-slate-700 text-slate-300'
                }`}
              >
                {myPlayer.delta > 0 ? `+${myPlayer.delta}` : myPlayer.delta} rating
              </span>
            )}
          </div>

          <span className="text-2xl font-black text-slate-600">VS</span>

          <div className="text-center">
            <span className="text-sm font-semibold text-slate-300 block">
              {oppPlayer?.handle ?? match.players[1]?.handle ?? 'Player 2'}
            </span>
            <div className="text-4xl sm:text-5xl font-mono font-black text-white mt-1">
              {oppPlayer?.score ?? match.players[1]?.score ?? 0}
            </div>
            {oppPlayer?.delta !== null && oppPlayer?.delta !== undefined && (
              <span
                className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  oppPlayer.delta > 0
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : oppPlayer.delta < 0
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-slate-700 text-slate-300'
                }`}
              >
                {oppPlayer.delta > 0 ? `+${oppPlayer.delta}` : oppPlayer.delta} rating
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Question Breakdown Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur">
        <h2 className="text-xl font-bold text-white mb-4">Question Breakdown</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400">
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
                    <td className="py-4 px-4 font-mono font-bold text-slate-500">{q.idx + 1}</td>
                    <td className="py-4 px-4 font-medium text-white">
                      <a
                        href={q.problem.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-indigo-400 transition-colors inline-flex items-center gap-1.5"
                      >
                        <span className="font-mono text-xs text-indigo-400">
                          {q.problem.contestId}
                          {q.problem.index}
                        </span>
                        <span>{q.problem.name}</span>
                        <span className="text-xs text-slate-500">↗</span>
                      </a>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-amber-300 font-semibold">
                        {q.problem.rating}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right font-mono font-bold text-white">
                      {score1 > 0 ? (
                        <span className="text-emerald-400">
                          +{score1} {isP1First && '★'}
                        </span>
                      ) : (
                        <span className="text-slate-600">0</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-right font-mono font-bold text-white">
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

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/leaderboard"
          className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
        >
          View Leaderboards
        </Link>
        <Link
          to="/play"
          className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-600/30"
        >
          Play Another Duel
        </Link>
      </div>
    </div>
  );
}
