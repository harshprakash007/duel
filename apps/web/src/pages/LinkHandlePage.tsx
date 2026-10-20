import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch, ApiError } from '../api/client';
import { useAuthStore } from '../store/auth';
import { CheckCircle2, Shield, ExternalLink, ArrowRight, Clock } from 'lucide-react';
import type { LinkStartResponse, LinkVerifyResponse, MyHandleResponse } from '@duel/shared';

export function LinkHandlePage() {
  const { fetchUser } = useAuthStore();
  const navigate = useNavigate();

  const [myHandleData, setMyHandleData] = useState<MyHandleResponse | null>(null);
  const [handleInput, setHandleInput] = useState('');
  const [verification, setVerification] = useState<LinkStartResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<LinkVerifyResponse | null>(null);
  const [timeLeftSec, setTimeLeftSec] = useState<number>(0);

  // Load existing handle and pending verification
  useEffect(() => {
    apiFetch<MyHandleResponse>('/api/handles/me')
      .then((data) => {
        setMyHandleData(data);
        if (data.pendingVerification) {
          const expiresAtMs = new Date(data.pendingVerification.expiresAt).getTime();
          const remainingSec = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
          if (remainingSec > 0) {
            setVerification({
              verificationId: data.pendingVerification.id,
              handle: data.pendingVerification.handle,
              problem: {
                contestId: data.pendingVerification.problemContestId,
                index: data.pendingVerification.problemIndex,
                url: data.pendingVerification.problemUrl,
              },
              instructions: `Submit a deliberately non-compiling solution to problem ${data.pendingVerification.problemContestId}${data.pendingVerification.problemIndex} on Codeforces within 5 minutes.`,
              startedAt: data.pendingVerification.startedAt,
              expiresAt: data.pendingVerification.expiresAt,
            });
            setTimeLeftSec(remainingSec);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!verification) return;
    const expiresAt = new Date(verification.expiresAt).getTime();

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeftSec(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [verification]);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handleInput.trim()) return;

    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch<LinkStartResponse>('/api/handles/link/start', {
        method: 'POST',
        body: JSON.stringify({ handle: handleInput.trim() }),
      });
      setVerification(res);
      const remaining = Math.max(
        0,
        Math.floor((new Date(res.expiresAt).getTime() - Date.now()) / 1000),
      );
      setTimeLeftSec(remaining);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to initiate handle verification.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError(null);
    setVerifying(true);

    try {
      const res = await apiFetch<LinkVerifyResponse>('/api/handles/link/verify', {
        method: 'POST',
      });
      setSuccess(res);
      setVerification(null);
      await fetchUser();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(
          'Verification check failed. Please make sure your CE submission is public on Codeforces.',
        );
      }
    } finally {
      setVerifying(false);
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // If already linked
  if (myHandleData?.handle) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12 font-mono">
        <div className="w-full max-w-lg rounded-3xl border border-emerald-500/40 bg-[#051c14]/90 p-8 shadow-[0_0_35px_rgba(16,185,129,0.2)] text-center backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-950/60 border border-emerald-500/60 text-emerald-400 mb-4 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <span className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">
            SECURITY CLEARANCE VERIFIED
          </span>
          <h2 className="text-2xl font-black text-white mt-1">Codeforces Handle Linked</h2>
          <p className="mt-2 text-xs text-slate-300">
            Your account is verified and ready for competitive duels.
          </p>

          <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-slate-950/80 p-5 flex justify-around">
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Handle</div>
              <div className="text-lg font-bold text-emerald-300 mt-1">
                {myHandleData.handle.handle}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">CF Rating</div>
              <div className="text-lg font-bold text-amber-400 mt-1">
                {myHandleData.handle.rating}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Matches</div>
              <div className="text-lg font-bold text-white mt-1">
                {myHandleData.handle.matchesPlayed}
              </div>
            </div>
          </div>

          <button
            onClick={() => navigate('/play')}
            className="mt-8 w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-3 text-xs font-bold text-white shadow-[0_0_20px_rgba(16,185,129,0.35)] hover:from-emerald-400 hover:to-teal-500 transition-all uppercase tracking-wider flex items-center justify-center gap-2"
          >
            <span>Enter Duel Arena</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-12 font-mono">
      <div className="w-full max-w-lg rounded-3xl border border-cyan-500/30 bg-[#060b17]/90 p-8 shadow-[0_0_35px_rgba(6,182,212,0.2)] backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white tracking-wider">HANDLE VERIFICATION</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Cryptographic proof of Codeforces account ownership.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3.5 text-xs text-rose-300">
            [ERROR] {error}
          </div>
        )}

        {success && (
          <div className="mb-6 rounded-2xl border border-emerald-500/40 bg-emerald-950/40 p-5 text-center shadow-[0_0_20px_rgba(16,185,129,0.2)]">
            <div className="text-emerald-300 font-bold text-base flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              VERIFICATION COMPLETE
            </div>
            <p className="text-xs text-slate-300 mt-2">
              Handle <span className="font-bold text-white">{success.handle}</span> bound with
              initial rating <span className="font-bold text-amber-400">{success.rating} Elo</span>.
            </p>
            <button
              onClick={() => navigate('/play')}
              className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all uppercase tracking-wider"
            >
              Enter Arena
            </button>
          </div>
        )}

        {!success && !verification && (
          <form onSubmit={handleStart} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                Codeforces Handle
              </label>
              <input
                type="text"
                required
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                className="w-full rounded-xl border border-cyan-500/30 bg-slate-950 px-4 py-2.5 text-xs text-white placeholder-slate-600 focus:border-cyan-400 focus:shadow-[0_0_15px_rgba(6,182,212,0.3)] focus:outline-none"
                placeholder="e.g. tourist"
              />
              <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                You will receive a randomized problem handshake to submit a harmless Compilation
                Error (CE) within 5 minutes.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-3 text-xs font-bold text-white shadow-[0_0_20px_rgba(6,182,212,0.35)] hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all uppercase tracking-wider flex items-center justify-center gap-2"
            >
              <span>{loading ? 'Validating Handle...' : 'Request Handshake Problem'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {!success && verification && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-cyan-500/30 bg-[#051120]/90 p-5">
              <div className="flex items-center justify-between text-xs text-cyan-300 font-bold mb-2">
                <span>HANDSHAKE CHALLENGE</span>
                <span className="font-mono bg-cyan-950 px-2.5 py-0.5 rounded-full text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {formatTimer(timeLeftSec)}
                </span>
              </div>
              <div className="text-lg font-black text-white">
                Problem {verification.problem.contestId}
                {verification.problem.index}
              </div>
              <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                {verification.instructions}
              </p>

              <div className="mt-4">
                <a
                  href={verification.problem.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-bold text-white shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:from-cyan-400 hover:to-blue-500 transition-all uppercase"
                >
                  <span>Open on Codeforces</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 text-[11px] text-slate-400 space-y-1.5">
              <div className="font-bold text-slate-200 uppercase">Step-by-Step:</div>
              <div>1. Open the Codeforces problem link above in a new tab.</div>
              <div>2. Submit code with an intentional syntax error (e.g. invalid text).</div>
              <div>3. Wait for Codeforces verdict to show COMPILATION_ERROR.</div>
              <div>4. Click &quot;Verify Submission&quot; below.</div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setVerification(null)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800 uppercase"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifying || timeLeftSec <= 0}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:bg-emerald-500 disabled:opacity-50 transition-all uppercase tracking-wider"
              >
                {verifying ? 'Scanning Codeforces...' : 'Verify Submission'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
