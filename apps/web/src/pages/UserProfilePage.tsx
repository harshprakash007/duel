import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Trash2, AlertTriangle, ExternalLink, Swords, Activity } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { apiFetch } from '../api/client';
import type { UserProfileDto, UserMatchesResponseDto, RatingPointDto } from '@duel/shared';

function RatingSparkline({ points }: { points: RatingPointDto[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-cyan-500/20 text-xs text-slate-500 font-mono">
        NO RANKED DUELS RECORDED YET
      </div>
    );
  }

  const values = points.map((p) => p.after);
  const minRating = Math.min(...values) - 20;
  const maxRating = Math.max(...values) + 20;
  const range = Math.max(maxRating - minRating, 40);

  const width = 600;
  const height = 160;
  const padding = 20;

  const getX = (index: number) => {
    if (points.length === 1) return width / 2;
    return padding + (index / (points.length - 1)) * (width - 2 * padding);
  };

  const getY = (val: number) => {
    const norm = (val - minRating) / range;
    return height - padding - norm * (height - 2 * padding);
  };

  const svgPoints = points
    .map((p, idx) => `${getX(idx).toFixed(1)},${getY(p.after).toFixed(1)}`)
    .join(' ');

  const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : null;

  return (
    <div className="relative font-mono">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-44 overflow-visible stroke-linecap-round"
      >
        <defs>
          <linearGradient id="neonLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00f0ff" />
            <stop offset="50%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        <line
          x1={padding}
          y1={padding}
          x2={width - padding}
          y2={padding}
          stroke="#0e172a"
          strokeDasharray="4 4"
        />
        <line
          x1={padding}
          y1={height / 2}
          x2={width - padding}
          y2={height / 2}
          stroke="#0e172a"
          strokeDasharray="4 4"
        />
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="#0e172a"
          strokeDasharray="4 4"
        />

        {/* The Neon Rating Line */}
        <polyline
          fill="none"
          stroke="url(#neonLineGrad)"
          strokeWidth="3.5"
          strokeLinejoin="round"
          filter="url(#neonGlow)"
          points={svgPoints}
        />

        {/* Dots */}
        {points.map((p, idx) => (
          <circle
            key={p.matchId}
            cx={getX(idx)}
            cy={getY(p.after)}
            r={hoveredIndex === idx ? 6 : 4}
            className={`transition-all cursor-pointer ${
              hoveredIndex === idx
                ? 'fill-cyan-300 stroke-white stroke-2'
                : 'fill-cyan-400 stroke-slate-950 stroke-2'
            }`}
            onMouseEnter={() => setHoveredIndex(idx)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
        ))}
      </svg>

      {/* Hover Tooltip */}
      {hoveredPoint && (
        <div className="absolute top-2 right-4 rounded-xl border border-cyan-500/40 bg-slate-950/90 p-3 text-xs shadow-xl backdrop-blur-md">
          <div className="font-bold text-white">Match #{hoveredPoint.matchId.slice(-6)}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-slate-400">Rating:</span>
            <span className="font-mono font-bold text-cyan-300">{hoveredPoint.after}</span>
            <span
              className={`font-mono text-[11px] font-bold ${
                hoveredPoint.delta > 0
                  ? 'text-emerald-400'
                  : hoveredPoint.delta < 0
                    ? 'text-rose-400'
                    : 'text-slate-500'
              }`}
            >
              ({hoveredPoint.delta > 0 ? `+${hoveredPoint.delta}` : hoveredPoint.delta})
            </span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {new Date(hoveredPoint.createdAt).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  );
}

export function UserProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const [matchPage, setMatchPage] = useState(0);
  const matchLimit = 10;

  // Account deletion modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['user-profile', handle],
    queryFn: async () => {
      return await apiFetch<UserProfileDto>(`/api/users/${handle}`);
    },
    enabled: Boolean(handle),
  });

  const { data: matchesData, isLoading: matchesLoading } = useQuery({
    queryKey: ['user-matches', handle, matchPage],
    queryFn: async () => {
      return await apiFetch<UserMatchesResponseDto>(
        `/api/users/${handle}/matches?limit=${matchLimit}&offset=${matchPage * matchLimit}`,
      );
    },
    enabled: Boolean(handle),
  });

  const isSelf = user?.handle?.handle?.toLowerCase() === handle?.toLowerCase();

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      setDeleteError('Password is required');
      return;
    }
    if (confirmText !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm');
      return;
    }

    setDeleteLoading(true);
    setDeleteError(null);

    try {
      await apiFetch('/api/me', {
        method: 'DELETE',
        body: JSON.stringify({ password: deletePassword }),
      });
      await logout();
      navigate('/');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setDeleteLoading(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center font-mono text-cyan-400 text-xs">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          <span>QUERYING DUELIST PROFILE...</span>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center font-mono">
        <h2 className="text-2xl font-black text-white">DUELIST NOT FOUND</h2>
        <p className="mt-2 text-xs text-slate-400">
          No profile exists for Codeforces handle "{handle}".
        </p>
        <Link
          to="/leaderboard"
          className="mt-6 inline-block rounded-xl bg-cyan-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-cyan-500 uppercase tracking-wider"
        >
          View Leaderboard
        </Link>
      </div>
    );
  }

  const matchTotalPages = matchesData ? Math.ceil(matchesData.total / matchLimit) : 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-8 font-mono">
      {/* Profile Header HUD */}
      <div className="neon-card rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-widest text-cyan-400 font-bold bg-cyan-950/50 border border-cyan-500/30 px-3 py-0.5 rounded-full">
              DUELIST DOSSIER
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white mt-2 tracking-wide flex items-center gap-3">
            <span>{profile.handle}</span>
            <a
              href={`https://codeforces.com/profile/${profile.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open Codeforces Profile"
              className="text-slate-500 hover:text-cyan-400 transition-colors"
            >
              <ExternalLink className="w-5 h-5" />
            </a>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Registered contestant &middot; Active on Codeforces
          </p>
        </div>

        {/* Rating Pills */}
        <div className="flex items-center gap-4">
          <div className="rounded-2xl border border-cyan-500/40 bg-slate-950/80 px-6 py-3.5 text-center shadow-[0_0_15px_rgba(6,182,212,0.2)]">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
              Current Elo
            </span>
            <span className="text-3xl font-extrabold text-cyan-300 neon-text-cyan">
              {profile.rating}
            </span>
          </div>

          <div className="rounded-2xl border border-violet-500/30 bg-slate-950/80 px-6 py-3.5 text-center">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
              Peak Elo
            </span>
            <span className="text-3xl font-extrabold text-violet-300">{profile.peakRating}</span>
          </div>

          {profile.globalRank && (
            <div className="rounded-2xl border border-amber-500/30 bg-slate-950/80 px-6 py-3.5 text-center">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
                Rank
              </span>
              <span className="text-3xl font-extrabold text-amber-400">#{profile.globalRank}</span>
            </div>
          )}
        </div>
      </div>

      {/* Performance Statistics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-cyan-500/20 bg-[#060b17]/90 p-5 text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Matches Played
          </span>
          <div className="text-2xl font-black text-white mt-1">{profile.matchesPlayed}</div>
        </div>
        <div className="rounded-2xl border border-cyan-500/20 bg-[#060b17]/90 p-5 text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Wins / Losses
          </span>
          <div className="text-2xl font-black text-emerald-400 mt-1">
            {profile.wins} <span className="text-slate-600 font-normal">/</span>{' '}
            <span className="text-rose-400">{profile.losses}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-cyan-500/20 bg-[#060b17]/90 p-5 text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Draws
          </span>
          <div className="text-2xl font-black text-slate-300 mt-1">{profile.draws}</div>
        </div>
        <div className="rounded-2xl border border-cyan-500/20 bg-[#060b17]/90 p-5 text-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Win Rate
          </span>
          <div className="text-2xl font-black text-cyan-400 mt-1">{profile.winRate}%</div>
        </div>
      </div>

      {/* Rating Sparkline Graph */}
      <div className="neon-card rounded-2xl p-6 sm:p-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span>Rating Trajectory (Last 20 Ranked Matches)</span>
          </h2>
        </div>
        <RatingSparkline points={profile.ratingHistory} />
      </div>

      {/* Match History Table */}
      <div className="neon-card rounded-2xl overflow-hidden">
        <div className="border-b border-cyan-500/15 px-6 py-4">
          <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Swords className="w-4 h-4 text-cyan-400" />
            <span>Match History</span>
          </h2>
        </div>

        {matchesLoading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading duel log...</div>
        ) : !matchesData || matchesData.matches.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">No past matches recorded yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-cyan-500/15 text-[11px] uppercase tracking-wider text-slate-400 bg-slate-950/70">
                  <th className="py-3 px-4">Result</th>
                  <th className="py-3 px-4">Opponent</th>
                  <th className="py-3 px-4">Sheet</th>
                  <th className="py-3 px-4 text-center">Score</th>
                  <th className="py-3 px-4 text-center">Rating &Delta;</th>
                  <th className="py-3 px-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {matchesData.matches.map((m) => {
                  const isWin = m.result === 'WIN';
                  const isLoss = m.result === 'LOSS';

                  return (
                    <tr key={m.matchId} className="hover:bg-cyan-950/10 transition-colors">
                      <td className="py-4 px-4 font-bold">
                        <Link
                          to={`/matches/${m.matchId}`}
                          className={`inline-block rounded px-2.5 py-0.5 text-xs font-black border ${
                            isWin
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                              : isLoss
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {m.result ?? 'ABORTED'}
                        </Link>
                      </td>
                      <td className="py-4 px-4 font-medium text-white">
                        {m.opponent ? (
                          <Link
                            to={`/u/${m.opponent.handle}`}
                            className="hover:text-cyan-400 transition-colors"
                          >
                            {m.opponent.handle}
                          </Link>
                        ) : (
                          <span className="text-slate-500">Solo</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-slate-400">{m.sheetName}</td>
                      <td className="py-4 px-4 text-center font-bold text-white">
                        {m.score} &ndash; {m.opponentScore}
                      </td>
                      <td className="py-4 px-4 text-center font-bold">
                        {m.delta !== null && m.delta !== undefined ? (
                          <span className={m.delta > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {m.delta > 0 ? `+${m.delta}` : m.delta}
                          </span>
                        ) : (
                          <span className="text-slate-600">&ndash;</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right text-slate-400">
                        {new Date(m.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {matchesData && matchesData.total > matchLimit && (
          <div className="border-t border-cyan-500/10 px-4 py-3 flex items-center justify-between text-xs text-slate-400 bg-slate-950/60">
            <span>
              Page {matchPage + 1} of {matchTotalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setMatchPage((p) => Math.max(0, p - 1))}
                disabled={matchPage === 0}
                className="rounded-lg border border-cyan-500/20 bg-slate-900 px-3 py-1 font-semibold text-slate-300 hover:text-white disabled:opacity-40 uppercase"
              >
                Prev
              </button>
              <button
                onClick={() => setMatchPage((p) => Math.min(matchTotalPages - 1, p + 1))}
                disabled={matchPage >= matchTotalPages - 1}
                className="rounded-lg border border-cyan-500/20 bg-slate-900 px-3 py-1 font-semibold text-slate-300 hover:text-white disabled:opacity-40 uppercase"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Danger Zone (Account Deletion) */}
      {isSelf && (
        <div className="rounded-2xl border border-rose-500/30 bg-[#16060a]/90 p-6 backdrop-blur-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-rose-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                DANGER ZONE // ACCOUNT DELETION
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-xl">
                Permanently deletes your personal data, unlinks Codeforces credentials, and
                anonymizes your historical match records. This action cannot be reversed.
              </p>
            </div>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-2.5 text-xs font-bold text-rose-300 hover:bg-rose-900/50 hover:border-rose-500/80 transition-all flex items-center gap-2 uppercase tracking-wider shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Account
            </button>
          </div>
        </div>
      )}

      {/* Account Deletion Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-[#16060a] p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
              CONFIRM ACCOUNT DELETION
            </h3>
            <p className="mt-2 text-xs text-slate-300">
              Please enter your password and type{' '}
              <span className="font-bold text-rose-400">DELETE</span> to confirm.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[10px] uppercase text-slate-400 block mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Password..."
                  className="w-full rounded-xl border border-rose-500/30 bg-slate-950 px-3 py-2 text-xs text-white focus:border-rose-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase text-slate-400 block mb-1">
                  Type "DELETE"
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="w-full rounded-xl border border-rose-500/30 bg-slate-950 px-3 py-2 text-xs text-white focus:border-rose-400 focus:outline-none"
                />
              </div>

              {deleteError && <p className="text-xs text-rose-400">{deleteError}</p>}
            </div>

            <div className="mt-6 flex justify-end gap-3 text-xs">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeletePassword('');
                  setConfirmText('');
                  setDeleteError(null);
                }}
                disabled={deleteLoading}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteLoading || !deletePassword || confirmText !== 'DELETE'}
                className="rounded-xl bg-rose-600 px-5 py-2 font-bold text-white hover:bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.4)] disabled:opacity-50"
              >
                {deleteLoading ? 'Scrubbing...' : 'Confirm Purge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
