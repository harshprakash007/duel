import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './store/auth';
import { Navbar } from './components/Navbar';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { LinkHandlePage } from './pages/LinkHandlePage';
import { LobbyPage } from './pages/LobbyPage';
import { MatchPage } from './pages/MatchPage';
import { MatchRecapPage } from './pages/MatchRecapPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { UserProfilePage } from './pages/UserProfilePage';
import { AdminPage } from './pages/AdminPage';

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
        <div className="min-h-screen cyber-bg text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
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
                    <LobbyPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/match/:id"
                element={
                  <ProtectedRoute>
                    <MatchPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/matches/:id" element={<MatchRecapPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/users/:handle" element={<UserProfilePage />} />
              <Route path="/u/:handle" element={<UserProfilePage />} />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <footer className="border-t border-cyan-500/10 py-6 text-center text-xs text-slate-500 bg-slate-950/60 backdrop-blur-md">
            <span className="text-cyan-400 font-semibold tracking-wider">DUEL</span> &middot;
            Real-time 1v1 Competitive Programming Arena &middot; Independent platform not affiliated
            with, endorsed by, or sponsored by Codeforces.
          </footer>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
