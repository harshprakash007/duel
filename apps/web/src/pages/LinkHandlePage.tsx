import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch, ApiError } from '../api/client';
import { useAuthStore } from '../store/auth';
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
              instructions: `Please submit a deliberately non-compiling solution to problem ${data.pendingVerification.problemContestId}${data.pendingVerification.problemIndex} on Codeforces within 5 minutes.`,
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
        setError('Verification check failed. Please try again.');
      }
    } finally {
      setVerifying(false);
    }
  };

  // If already linked
  if (myHandleData?.handle) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-xl text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-2xl mb-4">
            ✓
          </div>
          <h2 className="text-2xl font-bold text-white">Codeforces Handle Linked</h2>
          <p className="mt-2 text-slate-400">Your account is verified and ready for duels.</p>

          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-800/50 p-6 flex justify-around">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider">Handle</div>
              <div className="text-lg font-bold text-emerald-400 mt-1">
                {myHandleData.handle.handle}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider">Rating</div>
              <div className="text-lg font-bold text-amber-300 mt-1">
                {myHandleData.handle.rating}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider">Matches</div>
              <div className="text-lg font-bold text-slate-200 mt-1">
                {myHandleData.handle.matchesPlayed}
              </div>
            </div>
          </div>

          <button
            onClick={() => navigate('/play')}
            className="mt-8 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-colors"
          >
            Enter Duel Arena
          </button>
        </div>
      </div>
    );
  }

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-xl">
        <h2 className="text-2xl font-bold text-white">Link Codeforces Handle</h2>
        <p className="mt-1 text-sm text-slate-400">
          Prove ownership of your Codeforces account via a quick test submission.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-sm text-red-400">
            {error}
          </div>
        )}

        {success && (
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
            <div className="text-emerald-400 font-bold text-lg">Verification Successful!</div>
            <p className="text-sm text-slate-300 mt-1">
              Handle <span className="font-semibold text-white">{success.handle}</span> has been
              linked with starting rating{' '}
              <span className="font-semibold text-amber-300">{success.rating}</span>.
            </p>
            <button
              onClick={() => navigate('/play')}
              className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
            >
              Go to Arena
            </button>
          </div>
        )}

        {!success && !verification && (
          <form onSubmit={handleStart} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">Codeforces Handle</label>
              <input
                type="text"
                required
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="e.g. tourist"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                You will be asked to submit a deliberately non-compiling solution to verify
                ownership.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-600/30 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Checking handle...' : 'Continue to Verification'}
            </button>
          </form>
        )}

        {!success && verification && (
          <div className="mt-6 space-y-5">
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
              <div className="flex items-center justify-between text-xs text-indigo-300 font-medium mb-1">
                <span>ASSIGNED PROBLEM</span>
                <span className="font-mono bg-indigo-900/50 px-2 py-0.5 rounded text-amber-300">
                  {formatTimer(timeLeftSec)}
                </span>
              </div>
              <div className="text-lg font-bold text-white">
                Problem {verification.problem.contestId}
                {verification.problem.index}
              </div>
              <p className="text-xs text-slate-300 mt-2">{verification.instructions}</p>

              <div className="mt-4">
                <a
                  href={verification.problem.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-500 transition-colors"
                >
                  <span>Open on Codeforces</span>
                  <span>↗</span>
                </a>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-800/40 p-4 text-xs text-slate-400 space-y-1.5">
              <div className="font-semibold text-slate-300">Instructions:</div>
              <div>1. Click the button above to open the problem on Codeforces.</div>
              <div>2. Submit code with a syntax error (e.g. invalid characters).</div>
              <div>3. Wait a few seconds for Codeforces to mark it COMPILATION_ERROR.</div>
              <div>4. Click &quot;Verify Submission&quot; below.</div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setVerification(null)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifying || timeLeftSec <= 0}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-emerald-600/30 hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                {verifying ? 'Checking Codeforces...' : 'Verify Submission'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
