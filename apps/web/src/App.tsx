import { useEffect, useState } from 'react';

export function App() {
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  useEffect(() => {
    fetch('/healthz')
      .then((r) => setHealth(r.ok ? 'ok' : 'down'))
      .catch(() => setHealth('down'));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-5xl font-bold tracking-tight">Duel</h1>
      <p className="text-slate-400">Real-time 1v1 competitive programming.</p>
      <p className="text-sm text-slate-500">API: {health}</p>
      <footer className="mt-10 text-xs text-slate-600">Not affiliated with Codeforces.</footer>
    </main>
  );
}
