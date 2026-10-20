import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Trophy, Medal, Crown, Flame, ChevronLeft, ChevronRight, Layers } from 'lucide-react';
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
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6 font-mono">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cyan-500/15 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-wider flex items-center gap-3">
            <Trophy className="w-8 h-8 text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]" />
            <span>HALL OF CHAMPIONS</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Authoritative Elo ratings and level sheet victory standings
          </p>
        </div>

        {/* Scope Tabs */}
        <div className="flex rounded-xl bg-slate-950 border border-cyan-500/20 p-1 shadow-[0_0_15px_rgba(6,182,212,0.1)]">
          <button
            onClick={() => {
              setScope('global');
              setPage(0);
            }}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all uppercase tracking-wider ${
              scope === 'global'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Global Elo
          </button>
          <button
            onClick={() => {
              setScope('sheet');
              setPage(0);
            }}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all uppercase tracking-wider ${
              scope === 'sheet'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Sheet Champions
          </button>
        </div>
      </div>

      {/* Sheet Selector (for sheet scope) */}
      {scope === 'sheet' && sheets && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-cyan-500/20 bg-slate-900/60 backdrop-blur-md">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Active Sheet:
          </span>
          <select
            value={activeSheetSlug}
            onChange={(e) => {
              setSelectedSheet(e.target.value);
              setPage(0);
            }}
            className="rounded-lg border border-cyan-500/30 bg-slate-950 px-3 py-1.5 text-xs font-bold text-cyan-300 focus:border-cyan-400 focus:outline-none"
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
        <div className="rounded-2xl border border-cyan-500/40 bg-[#061026]/90 p-4 backdrop-blur-xl flex items-center justify-between shadow-[0_0_20px_rgba(6,182,212,0.2)]">
          <div className="flex items-center gap-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-600/30 border border-cyan-500/50 text-sm font-extrabold text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
              #{lb.myRank.rank}
            </span>
            <div>
              <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest block">
                YOUR STANDING
              </span>
              <div className="text-sm font-bold text-white">Ranked #{lb.myRank.rank} Globally</div>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
              {scope === 'global' ? 'Rating' : 'Wins'}
            </span>
            <span className="text-2xl font-black text-cyan-300 neon-text-cyan">
              {lb.myRank.score}
            </span>
          </div>
        </div>
      )}

      {/* Ranking Table Card */}
      <div className="neon-card rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center text-xs text-cyan-400 flex flex-col items-center justify-center gap-3">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
            <span>SYNCING LEADERBOARD TELEMETRY...</span>
          </div>
        ) : !lb || lb.entries.length === 0 ? (
          <div className="p-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
            <Flame className="w-8 h-8 text-slate-600" />
            <span className="text-slate-300 font-bold">NO RANKED DUELISTS YET</span>
            <span>Complete at least 5 ranked matches to qualify for authoritative standings.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-cyan-500/15 text-[11px] uppercase tracking-wider text-slate-400 bg-slate-950/70">
                  <th className="py-3.5 px-4 w-20 text-center">Rank</th>
                  <th className="py-3.5 px-4">Duelist</th>
                  <th className="py-3.5 px-4 text-center">
                    {scope === 'global' ? 'Elo Rating' : 'Sheet Wins'}
                  </th>
                  <th className="py-3.5 px-4 text-center">Matches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {lb.entries.map((entry) => (
                  <tr key={entry.userId} className="hover:bg-cyan-950/10 transition-colors group">
                    <td className="py-4 px-4 text-center font-bold">
                      {entry.rank === 1 ? (
                        <span className="inline-flex items-center gap-1 text-amber-400 font-black text-sm drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]">
                          <Crown className="w-4 h-4 fill-amber-400" /> 1
                        </span>
                      ) : entry.rank === 2 ? (
                        <span className="inline-flex items-center gap-1 text-slate-300 font-black text-sm drop-shadow-[0_0_8px_rgba(203,213,225,0.5)]">
                          <Medal className="w-4 h-4" /> 2
                        </span>
                      ) : entry.rank === 3 ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-black text-sm drop-shadow-[0_0_8px_rgba(217,119,6,0.5)]">
                          <Medal className="w-4 h-4" /> 3
                        </span>
                      ) : (
                        <span className="text-slate-500 font-bold">#{entry.rank}</span>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <Link
                        to={`/u/${entry.handle}`}
                        className="font-bold text-white group-hover:text-cyan-400 transition-colors inline-flex items-center gap-2"
                      >
                        <span className="group-hover:translate-x-0.5 transition-transform">
                          {entry.handle}
                        </span>
                      </Link>
                    </td>
                    <td className="py-4 px-4 text-center font-bold text-emerald-400 text-sm">
                      {scope === 'global' ? entry.rating : entry.wins}
                    </td>
                    <td className="py-4 px-4 text-center text-slate-400">{entry.matchesPlayed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {lb && lb.total > limit && (
          <div className="border-t border-cyan-500/10 px-4 py-3 flex items-center justify-between text-xs text-slate-400 bg-slate-950/60">
            <span>
              Showing {page * limit + 1} &ndash; {Math.min((page + 1) * limit, lb.total)} of{' '}
              {lb.total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-cyan-500/20 bg-slate-900 px-3 py-1.5 font-bold text-slate-300 hover:text-white hover:border-cyan-500/50 disabled:opacity-40 flex items-center gap-1 uppercase"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-lg border border-cyan-500/20 bg-slate-900 px-3 py-1.5 font-bold text-slate-300 hover:text-white hover:border-cyan-500/50 disabled:opacity-40 flex items-center gap-1 uppercase"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
