import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { useSocketStore } from '../store/socket';
import { apiFetch } from '../api/client';
import type { SheetDto, MatchStateSnapshot } from '@duel/shared';

export function LobbyPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    connect,
    isConnected,
    queueStatus,
    activeMatch,
    joinQueue,
    leaveQueue,
    createRoom,
    joinRoom,
    setReady,
    roomCode,
  } = useSocketStore();

  const [selectedSheetSlug, setSelectedSheetSlug] = useState<string>('');
  const [customRoomCodeInput, setCustomRoomCodeInput] = useState('');
  const [customQuestionCount, setCustomQuestionCount] = useState(3);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [localWaitSec, setLocalWaitSec] = useState(0);

  // Connect socket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  // Check if user already has an active match
  useEffect(() => {
    async function checkActive() {
      try {
        const res = await apiFetch<{ match: MatchStateSnapshot | null }>('/api/me/active-match');
        if (res.match && res.match.status !== 'FINISHED' && res.match.status !== 'ABORTED') {
          navigate(`/match/${res.match.matchId}`);
        }
      } catch {
        // Not in active match
      }
    }
    void checkActive();
  }, [navigate]);

  // Navigate to match once activeMatch is set
  useEffect(() => {
    if (activeMatch && activeMatch.status !== 'FINISHED' && activeMatch.status !== 'ABORTED') {
      navigate(`/match/${activeMatch.matchId}`);
    }
  }, [activeMatch, navigate]);

  // Local seconds ticker while in queue
  useEffect(() => {
    if (!queueStatus?.inQueue) {
      setLocalWaitSec(0);
      return;
    }
    const interval = setInterval(() => {
      setLocalWaitSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [queueStatus?.inQueue]);

  // Fetch available sheets
  const { data: sheets, isLoading: sheetsLoading } = useQuery({
    queryKey: ['sheets'],
    queryFn: async () => {
      const res = await apiFetch<{ sheets: SheetDto[] }>('/api/sheets');
      return res.sheets;
    },
  });

  // Select first sheet once loaded
  useEffect(() => {
    if (sheets && sheets.length > 0 && !selectedSheetSlug) {
      const first = sheets[0];
      if (first) {
        setSelectedSheetSlug(first.slug);
      }
    }
  }, [sheets, selectedSheetSlug]);

  const handleStartQueue = async () => {
    setActionError(null);
    if (!selectedSheetSlug) return;
    const res = await joinQueue(selectedSheetSlug);
    if (!res.ok) {
      setActionError(res.error ?? 'Failed to join matchmaking queue');
    }
  };

  const handleCancelQueue = async () => {
    setActionError(null);
    await leaveQueue();
  };

  const handleCreateRoom = async () => {
    setActionError(null);
    setIsCreatingRoom(true);
    try {
      const res = await createRoom(selectedSheetSlug, customQuestionCount);
      if (!res.ok) {
        setActionError(res.error ?? 'Failed to create room');
      }
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    const code = customRoomCodeInput.trim().toUpperCase();
    if (!code) return;
    const res = await joinRoom(code);
    if (!res.ok) {
      setActionError(res.error ?? 'Failed to join room');
    }
  };

  const handleCopyCode = () => {
    if (!roomCode) return;
    void navigator.clipboard.writeText(roomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const formatTimer = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Linked Handle Warning Banner */}
      {!user?.handle && (
        <div className="mb-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 backdrop-blur">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-amber-300">Codeforces Handle Required</h3>
              <p className="text-sm text-slate-400 mt-0.5">
                Link and verify your Codeforces account to enter ranked matchmaking and private
                rooms.
              </p>
            </div>
            <Link
              to="/link-handle"
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 transition-colors"
            >
              Link Handle Now
            </Link>
          </div>
        </div>
      )}

      {/* Action Error Banner */}
      {actionError && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {actionError}
        </div>
      )}

      {/* Queue Modal / Active Overlay */}
      {queueStatus?.inQueue && (
        <div className="mb-8 rounded-2xl border border-indigo-500/40 bg-indigo-950/40 p-6 sm:p-8 backdrop-blur shadow-2xl shadow-indigo-950/60">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600/30 border border-indigo-500/50">
                <span className="text-2xl animate-pulse">⚔</span>
                <div className="absolute inset-0 rounded-2xl border-2 border-indigo-500 animate-ping opacity-25" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold text-white">Searching for Opponent...</h3>
                  <span className="rounded-full bg-indigo-500/20 border border-indigo-500/40 px-2.5 py-0.5 text-xs font-semibold text-indigo-300">
                    Ranked
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Sheet: <span className="font-medium text-slate-200">{queueStatus.sheetSlug}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <div className="text-center">
                <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                  Elapsed Time
                </span>
                <div className="text-2xl font-mono font-bold text-white">
                  {formatTimer(localWaitSec || Math.floor(queueStatus.waitedMs / 1000))}
                </div>
              </div>

              <div className="text-center border-l border-slate-800 pl-6">
                <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                  Rating Window
                </span>
                <div className="text-2xl font-mono font-bold text-indigo-400">
                  &plusmn;{queueStatus.window}
                </div>
              </div>

              <button
                onClick={handleCancelQueue}
                className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors"
              >
                Cancel Queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Room Lobby Card */}
      {roomCode && !queueStatus?.inQueue && (
        <div className="mb-8 rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-6 sm:p-8 backdrop-blur">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <span className="text-xs uppercase tracking-wider text-emerald-400 font-bold">
                Private Room Lobby
              </span>
              <h3 className="text-2xl font-black text-white mt-1">
                Room Code:{' '}
                <span className="font-mono tracking-widest text-emerald-300">{roomCode}</span>
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                Share this 6-character code with your opponent. Match starts when both players click
                Ready.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleCopyCode}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 transition-colors"
              >
                {copiedCode ? '✓ Copied!' : 'Copy Code'}
              </button>
              <button
                onClick={setReady}
                className="rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-600/30"
              >
                Ready to Duel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Level Sheets Selector */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Level Sheets</h2>
              <p className="text-sm text-slate-400">
                Choose a difficulty band based on Codeforces ratings
              </p>
            </div>
          </div>

          {sheetsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 rounded-xl bg-slate-900/60 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sheets?.map((s) => {
                const isSelected = selectedSheetSlug === s.slug;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSheetSlug(s.slug)}
                    className={`text-left p-5 rounded-2xl border transition-all ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-950/30 shadow-lg shadow-indigo-950/40'
                        : 'border-slate-800/80 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-lg">{s.name}</span>
                      <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs font-semibold text-indigo-300">
                        {s.minRating} &ndash; {s.maxRating}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                      {s.description || 'Curated problem set from Codeforces.'}
                    </p>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>{s.questionCount} Questions</span>
                      <span>{s.problemCount ?? 0} active problems</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Duel Controls */}
        <div className="space-y-6">
          {/* Ranked Matchmaking Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur">
            <h3 className="text-lg font-bold text-white">Ranked 1v1 Queue</h3>
            <p className="text-xs text-slate-400 mt-1">
              Match against a player with similar platform rating. Scores update live Elo.
            </p>

            <button
              onClick={handleStartQueue}
              disabled={!user?.handle || queueStatus?.inQueue || !isConnected}
              className={`mt-6 w-full rounded-xl py-3.5 text-sm font-bold text-white transition-all shadow-lg ${
                !user?.handle || queueStatus?.inQueue || !isConnected
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                  : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
              }`}
            >
              {queueStatus?.inQueue ? 'Already in Queue' : 'Enter Ranked Queue'}
            </button>
          </div>

          {/* Custom Private Rooms Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Custom Private Room</h3>
              <p className="text-xs text-slate-400 mt-1">
                Play an unrated friendly match with a friend using a 6-character room code.
              </p>
            </div>

            {/* Create Room Form */}
            <div className="border-t border-slate-800 pt-4 space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Create Room
              </span>
              <div>
                <label className="text-xs text-slate-400">
                  Question Count: {customQuestionCount}
                </label>
                <input
                  type="range"
                  min="3"
                  max="5"
                  value={customQuestionCount}
                  onChange={(e) => setCustomQuestionCount(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>
              <button
                onClick={handleCreateRoom}
                disabled={!user?.handle || isCreatingRoom || queueStatus?.inQueue}
                className="w-full rounded-xl border border-slate-700 bg-slate-800/80 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                {isCreatingRoom ? 'Creating...' : 'Create Private Room'}
              </button>
            </div>

            {/* Join Room Form */}
            <form onSubmit={handleJoinRoom} className="border-t border-slate-800 pt-4 space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Join with Code
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="CODE6"
                  value={customRoomCodeInput}
                  onChange={(e) => setCustomRoomCodeInput(e.target.value.toUpperCase())}
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-center font-mono font-bold uppercase text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!user?.handle || customRoomCodeInput.length < 6}
                  className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
