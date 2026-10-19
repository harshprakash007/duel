import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Trash2, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { apiFetch } from '../api/client';
import type { UserProfileDto, UserMatchesResponseDto, RatingPointDto } from '@duel/shared';

function RatingSparkline({ points }: { points: RatingPointDto[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-800 text-xs text-slate-500">
        No rated duels completed yet
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
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-44 overflow-visible stroke-linecap-round"
      >
        <defs>
          <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        <line
          x1={padding}
          y1={padding}
          x2={width - padding}
          y2={padding}
          stroke="#1e293b"
          strokeDasharray="4 4"
        />
        <line
          x1={padding}
          y1={height / 2}
          x2={width - padding}
          y2={height / 2}
          stroke="#1e293b"
          strokeDasharray="4 4"
        />
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="#1e293b"
          strokeDasharray="4 4"
        />

        {/* The Rating Line */}
        <polyline
          fill="none"
          stroke="url(#lineGrad)"
          strokeWidth="3"
          strokeLinejoin="round"
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
                ? 'fill-white stroke-indigo-500 stroke-2'
                : 'fill-indigo-400 hover:fill-white'
            }`}
            onMouseEnter={() => setHoveredIndex(idx)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredPoint && hoveredIndex !== null && (
        <div
          className="absolute pointer-events-none rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs shadow-xl backdrop-blur -translate-x-1/2 -top-10"
          style={{
            left: `${(getX(hoveredIndex) / width) * 100}%`,
          }}
        >
          <span className="font-bold text-white">{hoveredPoint.after}</span>
          <span
            className={`ml-1.5 font-bold ${
              hoveredPoint.delta > 0
                ? 'text-emerald-400'
                : hoveredPoint.delta < 0
                  ? 'text-rose-400'
                  : 'text-slate-400'
            }`}
          >
            ({hoveredPoint.delta > 0 ? `+${hoveredPoint.delta}` : hoveredPoint.delta})
          </span>
        </div>
      )}
    </div>
  );
}

export function UserProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const [matchPage, setMatchPage] = useState(0);
  const matchLimit = 10;
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isOwnProfile = Boolean(
    user && user.handle && handle && user.handle.handle.toLowerCase() === handle.toLowerCase(),
  );

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch('/api/me', { method: 'DELETE' });
      logout();
      navigate('/');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account');
      setIsDeleting(false);
    }
  };

  // 1. Fetch user profile stats & sparkline
  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
  } = useQuery({
    queryKey: ['user-profile', handle],
    queryFn: async () => {
      return await apiFetch<UserProfileDto>(`/api/users/${handle}`);
    },
    enabled: Boolean(handle),
  });

  // 2. Fetch paginated match history
  const { data: matchesData, isLoading: matchesLoading } = useQuery({
    queryKey: ['user-matches', handle, matchPage, matchLimit],
    queryFn: async () => {
      return await apiFetch<UserMatchesResponseDto>(
        `/api/users/${handle}/matches?limit=${matchLimit}&offset=${matchPage * matchLimit}`,
      );
    },
    enabled: Boolean(handle),
  });

  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500">
        Loading player profile...
      </div>
    );
  }

  if (profileError || !profile) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-white">Player Not Found</h2>
        <p className="mt-2 text-sm text-slate-400">
          User &quot;{handle}&quot; has not registered or linked a Codeforces account on Duel.
        </p>
        <Link
          to="/leaderboard"
          className="mt-6 inline-block rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-indigo-500"
        >
          View Leaderboards
        </Link>
      </div>
    );
  }

  const totalPages = matchesData ? Math.ceil(matchesData.total / matchLimit) : 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      {/* Profile Header Card */}
      <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 sm:p-8 backdrop-blur flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 text-3xl font-black text-white shadow-xl shadow-indigo-600/30">
            {profile.handle.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-black text-white">{profile.handle}</h1>
              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-xs font-bold text-emerald-300">
                Verified CF
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              {profile.displayName} &middot; Member since{' '}
              {new Date(profile.verifiedAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Rating Pills */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="rounded-2xl border border-indigo-500/40 bg-indigo-950/30 px-5 py-3 text-center">
            <span className="text-xs uppercase tracking-wider text-indigo-400 font-bold block">
              Duel Rating
            </span>
            <span className="text-3xl font-mono font-black text-white">{profile.rating}</span>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-5 py-3 text-center">
            <span className="text-xs uppercase tracking-wider text-slate-400 font-bold block">
              Peak
            </span>
            <span className="text-3xl font-mono font-bold text-slate-200">
              {profile.peakRating}
            </span>
          </div>

          {profile.globalRank && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-5 py-3 text-center">
              <span className="text-xs uppercase tracking-wider text-slate-400 font-bold block">
                Rank
              </span>
              <span className="text-3xl font-mono font-bold text-amber-400">
                #{profile.globalRank}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Statistics Performance Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-center">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Matches Played
          </span>
          <div className="text-2xl font-mono font-black text-white mt-1">
            {profile.matchesPlayed}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-center">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Wins / Losses
          </span>
          <div className="text-2xl font-mono font-black text-emerald-400 mt-1">
            {profile.wins} <span className="text-slate-600 font-normal">/</span>{' '}
            <span className="text-rose-400">{profile.losses}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-center">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Draws
          </span>
          <div className="text-2xl font-mono font-black text-slate-300 mt-1">{profile.draws}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-center">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Win Rate
          </span>
          <div className="text-2xl font-mono font-black text-indigo-400 mt-1">
            {profile.winRate}%
          </div>
        </div>
      </div>

      {/* Rating Sparkline Graph */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Rating Trajectory</h2>
          <span className="text-xs text-slate-400">Last 20 Ranked Matches</span>
        </div>
        <RatingSparkline points={profile.ratingHistory} />
      </div>

      {/* Match History Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur overflow-hidden">
        <div className="border-b border-slate-800 px-6 py-4">
          <h2 className="text-lg font-bold text-white">Match History</h2>
        </div>

        {matchesLoading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading match history...</div>
        ) : !matchesData || matchesData.matches.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No past matches recorded yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400 bg-slate-900/80">
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
                    <tr key={m.matchId} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-4 px-4 font-bold">
                        <Link
                          to={`/matches/${m.matchId}`}
                          className={`inline-block rounded px-2 py-0.5 text-xs font-black ${
                            isWin
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : isLoss
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {m.result ?? 'ABORTED'}
                        </Link>
                      </td>
                      <td className="py-4 px-4 font-medium text-white">
                        {m.opponent ? (
                          <Link
                            to={`/users/${m.opponent.handle}`}
                            className="hover:text-indigo-400 transition-colors"
                          >
                            {m.opponent.handle}
                          </Link>
                        ) : (
                          <span className="text-slate-500">Solo</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-xs text-slate-400">{m.sheetName}</td>
                      <td className="py-4 px-4 text-center font-mono font-bold text-white">
                        {m.score} &ndash; {m.opponentScore}
                      </td>
                      <td className="py-4 px-4 text-center font-mono font-bold">
                        {m.delta !== null && m.delta !== undefined ? (
                          <span className={m.delta > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {m.delta > 0 ? `+${m.delta}` : m.delta}
                          </span>
                        ) : (
                          <span className="text-slate-600">&ndash;</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right text-xs text-slate-500">
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
          <div className="border-t border-slate-800 px-4 py-3 flex items-center justify-between text-xs text-slate-400">
            <span>
              Showing {matchPage * matchLimit + 1} &ndash;{' '}
              {Math.min((matchPage + 1) * matchLimit, matchesData.total)} of {matchesData.total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setMatchPage((p) => Math.max(0, p - 1))}
                disabled={matchPage === 0}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setMatchPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={matchPage >= totalPages - 1}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Danger Zone: Account Deletion */}
      {isOwnProfile && (
        <div className="mt-8 rounded-2xl border border-rose-900/40 bg-rose-950/20 p-6 backdrop-blur">
          <h3 className="text-base font-bold text-rose-300 flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Danger Zone
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            Permanently delete your account. In accordance with data minimization, your email,
            password, and linked Codeforces handle will be permanently removed and personal data
            anonymized. Past match records and rating histories are preserved with anonymized
            attribution.
          </p>
          <div className="mt-4">
            <button
              onClick={() => setShowDeleteModal(true)}
              className="rounded-xl border border-rose-700/60 bg-rose-900/40 px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-900/60 transition-colors"
            >
              Delete Account
            </button>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-xl font-bold text-white">Permanently Delete Account?</h3>
            </div>
            <p className="text-sm text-slate-300 mb-4 leading-relaxed">
              This action cannot be undone. All your personal data will be erased and your
              Codeforces handle unlinked.
            </p>
            <p className="text-xs text-slate-400 mb-2">
              Please type <strong className="text-rose-400 font-mono">DELETE</strong> to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white focus:border-rose-500 focus:outline-none font-mono"
            />
            {deleteError && <p className="mt-2 text-xs text-rose-400">{deleteError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText('');
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== 'DELETE' || isDeleting}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-40 transition-colors"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Deletion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
