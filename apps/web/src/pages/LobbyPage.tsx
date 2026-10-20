import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { useSocketStore } from '../store/socket';
import { apiFetch } from '../api/client';
import {
  Swords,
  Radio,
  Layers,
  Copy,
  Check,
  AlertTriangle,
  Play,
  Users,
  Clock,
} from 'lucide-react';
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
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Linked Handle Warning Banner */}
      {!user?.handle && (
        <div className="mb-8 rounded-2xl border border-amber-500/40 bg-amber-950/20 p-5 backdrop-blur-md shadow-[0_0_20px_rgba(245,158,11,0.15)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-amber-300 tracking-wide font-mono">
                Codeforces Verification Required
              </h3>
              <p className="text-sm text-slate-400 mt-0.5">
                Link and verify your Codeforces handle to enter ranked matchmaking and private duel
                rooms.
              </p>
            </div>
          </div>
          <Link
            to="/link-handle"
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-all font-mono uppercase tracking-wider shadow-[0_0_15px_rgba(245,158,11,0.3)] shrink-0"
          >
            Verify Handle
          </Link>
        </div>
      )}

      {/* Action Error Banner */}
      {actionError && (
        <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-300 font-mono shadow-[0_0_15px_rgba(244,63,94,0.2)]">
          [ERROR] {actionError}
        </div>
      )}

      {/* Queue Active Cyber Radar Overlay */}
      {queueStatus?.inQueue && (
        <div className="mb-8 rounded-2xl border border-cyan-500/40 bg-[#060e20]/90 p-6 sm:p-8 backdrop-blur-xl shadow-[0_0_35px_rgba(6,182,212,0.25)] relative overflow-hidden">
          {/* Subtle Radar Background Sweep */}
          <div className="absolute -right-20 -bottom-20 w-80 h-80 rounded-full border border-cyan-500/20 pointer-events-none opacity-40">
            <div className="w-full h-full rounded-full border border-cyan-500/10 radar-sweep bg-gradient-to-tr from-cyan-500/10 to-transparent" />
          </div>

          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-950/80 border border-cyan-500/60 shadow-[0_0_20px_rgba(6,182,212,0.4)]">
                <Radio className="w-8 h-8 text-cyan-400 animate-pulse" />
                <div className="absolute inset-0 rounded-2xl border border-cyan-400 animate-ping opacity-30" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="text-xl font-extrabold text-white font-mono tracking-wide">
                    SCANNING FOR OPPONENT
                  </h3>
                  <span className="rounded-full bg-cyan-500/20 border border-cyan-500/40 px-2.5 py-0.5 text-xs font-mono font-bold text-cyan-300">
                    RANKED 1v1
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-1 font-mono">
                  SHEET: <span className="text-cyan-300 font-bold">{queueStatus.sheetSlug}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <div className="text-center">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">
                  Queue Time
                </span>
                <div className="text-2xl font-mono font-extrabold text-white">
                  {formatTimer(localWaitSec || Math.floor(queueStatus.waitedMs / 1000))}
                </div>
              </div>

              <div className="text-center border-l border-slate-800 pl-6">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">
                  Rating Band
                </span>
                <div className="text-2xl font-mono font-extrabold text-cyan-400 neon-text-cyan">
                  &plusmn;{queueStatus.window}
                </div>
              </div>

              <button
                onClick={handleCancelQueue}
                className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-5 py-2.5 text-xs font-mono font-bold text-rose-300 hover:bg-rose-900/40 hover:border-rose-500/70 hover:shadow-[0_0_15px_rgba(244,63,94,0.3)] transition-all uppercase tracking-wider"
              >
                Cancel Queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Room Lobby Card */}
      {roomCode && !queueStatus?.inQueue && (
        <div className="mb-8 rounded-2xl border border-emerald-500/40 bg-[#051a14]/90 p-6 sm:p-8 backdrop-blur-xl shadow-[0_0_30px_rgba(16,185,129,0.2)]">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <span className="text-xs uppercase tracking-widest text-emerald-400 font-mono font-bold">
                PRIVATE ARENA // CODE GENERATED
              </span>
              <h3 className="text-3xl font-black text-white mt-1 font-mono tracking-widest flex items-center gap-3">
                <span className="text-emerald-300 neon-text-emerald">{roomCode}</span>
              </h3>
              <p className="text-sm text-slate-400 mt-1 font-mono">
                Share this 6-character room code with your opponent. Match starts when both players
                signal Ready.
              </p>
            </div>

            <div className="flex items-center gap-3 font-mono">
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-slate-900/80 px-4 py-2.5 text-xs font-bold text-emerald-300 hover:bg-emerald-950/40 hover:border-emerald-500/60 transition-all uppercase"
              >
                {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
              </button>
              <button
                onClick={setReady}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-xs font-bold text-white hover:from-emerald-400 hover:to-teal-500 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] uppercase tracking-wider"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Ready to Duel</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Sheets on Left, Arena Controls on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Level Sheets Selector */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between border-b border-cyan-500/15 pb-4">
            <div>
              <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
                <Layers className="w-6 h-6 text-cyan-400" />
                <span>Level Sheets</span>
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Target Codeforces rating tiers from Rookie to Master
              </p>
            </div>
          </div>

          {sheetsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="h-36 rounded-2xl bg-slate-900/40 border border-slate-800/80 animate-pulse"
                />
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
                    className={`text-left p-5 rounded-2xl border transition-all relative overflow-hidden group ${
                      isSelected
                        ? 'border-cyan-400 bg-cyan-950/20 shadow-[0_0_25px_rgba(6,182,212,0.25)]'
                        : 'border-slate-800/80 bg-slate-900/40 hover:border-cyan-500/40 hover:bg-slate-900/70'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-0 right-0 w-16 h-16 bg-cyan-500/10 rounded-bl-full pointer-events-none" />
                    )}
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-white text-base tracking-wide font-mono">
                        {s.name}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-mono font-bold border ${
                          isSelected
                            ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-300'
                            : 'bg-slate-800/80 border-slate-700 text-slate-300'
                        }`}
                      >
                        {s.minRating} &ndash; {s.maxRating}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2.5 line-clamp-2 leading-relaxed">
                      {s.description || 'Curated problem set from Codeforces.'}
                    </p>
                    <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {s.questionCount} Questions
                      </span>
                      <span className="text-slate-400">{s.problemCount ?? 0} problems</span>
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
          <div className="neon-card rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-2">
              <Swords className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-bold text-white tracking-wide">Ranked 1v1 Queue</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Match against a player with similar Elo on the selected sheet. Points count toward
              global standings.
            </p>

            <button
              onClick={handleStartQueue}
              disabled={!user?.handle || queueStatus?.inQueue || !isConnected}
              className={`mt-6 w-full rounded-xl py-3.5 text-xs font-mono font-bold uppercase tracking-wider transition-all shadow-lg ${
                !user?.handle || queueStatus?.inQueue || !isConnected
                  ? 'bg-slate-800/60 text-slate-500 border border-slate-700 cursor-not-allowed shadow-none'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.35)]'
              }`}
            >
              {queueStatus?.inQueue ? 'Already In Queue' : 'Enter Ranked Queue'}
            </button>
          </div>

          {/* Custom Private Rooms Card */}
          <div className="neon-card-violet rounded-2xl p-6 space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-violet-400" />
                <h3 className="text-lg font-bold text-white tracking-wide">Private Arena</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Play an unranked friendly match with a peer using a 6-character room code.
              </p>
            </div>

            {/* Create Room Form */}
            <div className="border-t border-violet-500/20 pt-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400 uppercase">Question Count:</span>
                <span className="text-violet-300 font-bold">{customQuestionCount} Questions</span>
              </div>
              <input
                type="range"
                min="3"
                max="5"
                value={customQuestionCount}
                onChange={(e) => setCustomQuestionCount(Number(e.target.value))}
                className="w-full accent-violet-500 cursor-pointer"
              />
              <button
                onClick={handleCreateRoom}
                disabled={!user?.handle || isCreatingRoom || queueStatus?.inQueue}
                className="w-full rounded-xl border border-violet-500/30 bg-violet-950/30 py-2.5 text-xs font-mono font-bold text-violet-200 hover:bg-violet-900/40 hover:border-violet-500/60 transition-all uppercase tracking-wider disabled:opacity-50"
              >
                {isCreatingRoom ? 'Creating...' : 'Create Room Code'}
              </button>
            </div>

            {/* Join Room Form */}
            <form
              onSubmit={handleJoinRoom}
              className="border-t border-violet-500/20 pt-4 space-y-3"
            >
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 block">
                Join with Room Code
              </span>
              <div className="flex gap-2 font-mono">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="CODE6"
                  value={customRoomCodeInput}
                  onChange={(e) => setCustomRoomCodeInput(e.target.value.toUpperCase())}
                  className="flex-1 rounded-xl border border-violet-500/30 bg-slate-950/90 px-3 py-2.5 text-center font-bold uppercase text-violet-200 placeholder-slate-600 focus:border-violet-400 focus:shadow-[0_0_15px_rgba(168,85,247,0.3)] focus:outline-none text-sm tracking-widest"
                />
                <button
                  type="submit"
                  disabled={!user?.handle || customRoomCodeInput.length < 6}
                  className="rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-violet-500 transition-all shadow-[0_0_15px_rgba(168,85,247,0.3)] disabled:opacity-50 uppercase tracking-wider"
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
