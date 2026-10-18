import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './store/auth';
import { Navbar } from './components/Navbar';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { LinkHandlePage } from './pages/LinkHandlePage';

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, initialized } = useAuthStore();
  if (isLoading || !initialized) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-400">
        Loading...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function App() {
  const { fetchUser } = useAuthStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
          <Navbar />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route
                path="/link-handle"
                element={
                  <ProtectedRoute>
                    <LinkHandlePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/play"
                element={
                  <ProtectedRoute>
                    <div className="mx-auto max-w-4xl px-4 py-16 text-center">
                      <h2 className="text-3xl font-bold">Duel Arena</h2>
                      <p className="mt-2 text-slate-400">
                        Matchmaking and live duels unlocking in upcoming milestones.
                      </p>
                    </div>
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-600">
            Duel &middot; Not affiliated with Codeforces.
          </footer>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
