import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import type { LeaderboardResponseDto, SheetDto } from '@duel/shared';

export function LeaderboardPage() {
  const [scope, setScope] = useState<'global' | 'sheet'>('global');
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [page, setPage] = useState(0);
  const limit = 25;

  // Fetch available sheets for sheet tab
  const { data: sheets } = useQuery({
    queryKey: ['sheets'],
    queryFn: async () => {
      const res = await apiFetch<{ sheets: SheetDto[] }>('/api/sheets');
      return res.sheets;
    },
  });

  // Default to first sheet if sheet scope active
  const activeSheetSlug = selectedSheet || (sheets && sheets[0] ? sheets[0].slug : '');

  // Fetch leaderboard entries
  const { data: lb, isLoading } = useQuery({
    queryKey: ['leaderboard', scope, activeSheetSlug, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        scope,
        limit: String(limit),
        offset: String(page * limit),
      });
      if (scope === 'sheet' && activeSheetSlug) {
        params.set('sheet', activeSheetSlug);
      }
      return await apiFetch<LeaderboardResponseDto>(`/api/leaderboard?${params.toString()}`);
    },
    enabled: scope === 'global' || Boolean(activeSheetSlug),
  });

  const totalPages = lb ? Math.ceil(lb.total / limit) : 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Leaderboards</h1>
          <p className="text-sm text-slate-400 mt-1">
            Authoritative player rankings and level sheet champions
          </p>
        </div>

        {/* Scope Tabs */}
        <div className="flex rounded-xl bg-slate-900 border border-slate-800 p-1">
          <button
            onClick={() => {
              setScope('global');
              setPage(0);
            }}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
              scope === 'global'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Global Elo
          </button>
          <button
            onClick={() => {
              setScope('sheet');
              setPage(0);
            }}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
              scope === 'sheet'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sheet Champions
          </button>
        </div>
      </div>

      {/* Sheet Selector (for sheet scope) */}
      {scope === 'sheet' && sheets && (
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Select Sheet:
          </span>
          <select
            value={activeSheetSlug}
            onChange={(e) => {
              setSelectedSheet(e.target.value);
              setPage(0);
            }}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none"
          >
            {sheets.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name} ({s.minRating}&ndash;{s.maxRating})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Sticky User Rank Bar */}
      {lb?.myRank && (
        <div className="rounded-2xl border border-indigo-500/40 bg-indigo-950/30 p-4 backdrop-blur flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
              #{lb.myRank.rank}
            </span>
            <div>
              <span className="text-xs text-indigo-300 font-semibold uppercase tracking-wider">
                Your Position
              </span>
              <div className="text-sm font-bold text-white">Ranked #{lb.myRank.rank}</div>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400 block font-medium">
              {scope === 'global' ? 'Rating' : 'Wins'}
            </span>
            <span className="text-xl font-mono font-black text-indigo-300">{lb.myRank.score}</span>
          </div>
        </div>
      )}

      {/* Ranking Table Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-slate-500">Loading rankings...</div>
        ) : !lb || lb.entries.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            No ranked players found. Complete at least 5 ranked matches to qualify!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400 bg-slate-900/80">
                  <th className="py-3 px-4 w-16 text-center">Rank</th>
                  <th className="py-3 px-4">Player</th>
                  <th className="py-3 px-4 text-center">
                    {scope === 'global' ? 'Rating' : 'Sheet Wins'}
                  </th>
                  <th className="py-3 px-4 text-center">Total Matches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {lb.entries.map((entry) => (
                  <tr key={entry.userId} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-4 px-4 text-center font-mono font-bold">
                      {entry.rank === 1 ? (
                        <span className="text-amber-400 font-black text-base">🥇 1</span>
                      ) : entry.rank === 2 ? (
                        <span className="text-slate-300 font-black text-base">🥈 2</span>
                      ) : entry.rank === 3 ? (
                        <span className="text-amber-600 font-black text-base">🥉 3</span>
                      ) : (
                        <span className="text-slate-500 font-semibold">#{entry.rank}</span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <Link
                        to={`/users/${entry.handle}`}
                        className="font-bold text-white hover:text-indigo-400 transition-colors flex items-center gap-2"
                      >
                        <span>{entry.handle}</span>
                      </Link>
                    </td>
                    <td className="py-4 px-4 text-center font-mono font-bold text-emerald-400">
                      {scope === 'global' ? entry.rating : entry.wins}
                    </td>
                    <td className="py-4 px-4 text-center font-mono text-slate-400">
                      {entry.matchesPlayed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {lb && lb.total > limit && (
          <div className="border-t border-slate-800 px-4 py-3 flex items-center justify-between text-xs text-slate-400">
            <span>
              Showing {page * limit + 1} &ndash; {Math.min((page + 1) * limit, lb.total)} of{' '}
              {lb.total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
