import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/auth';
import { apiFetch, ApiError } from '../api/client';
import {
  ShieldAlert,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Layers,
  FileText,
  Ban,
  Clock,
  Terminal,
} from 'lucide-react';
import type { ReportDto, SheetDto } from '@duel/shared';

export function AdminPage() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'reports' | 'sheets' | 'sync'>('reports');

  // Reports state
  const [reports, setReports] = useState<ReportDto[]>([]);
  const [reportFilter, setReportFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED' | 'DISMISSED'>(
    'OPEN',
  );
  const [loadingReports, setLoadingReports] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [voidModalMatchId, setVoidModalMatchId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sheets state
  const [sheets, setSheets] = useState<SheetDto[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<unknown>(null);

  const fetchReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const query = reportFilter === 'ALL' ? '' : `?status=${reportFilter}`;
      const res = await apiFetch<{ reports: ReportDto[]; total: number }>(
        `/api/admin/reports${query}`,
      );
      setReports(res.reports);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingReports(false);
    }
  }, [reportFilter]);

  const fetchSheets = useCallback(async () => {
    setLoadingSheets(true);
    try {
      const res = await apiFetch<{ sheets: SheetDto[] }>('/api/admin/sheets');
      setSheets(res.sheets);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSheets(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      if (activeTab === 'reports') {
        void fetchReports();
      } else if (activeTab === 'sheets') {
        void fetchSheets();
      }
    }
  }, [user, activeTab, fetchReports, fetchSheets]);

  const handleUpdateStatus = async (reportId: string, status: 'RESOLVED' | 'DISMISSED') => {
    setActionLoading(reportId);
    try {
      await apiFetch(`/api/admin/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setMessage({ type: 'success', text: `Report marked as ${status.toLowerCase()}` });
      await fetchReports();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'Failed to update report status',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleVoidMatch = async (matchId: string) => {
    setVoiding(true);
    try {
      const res = await apiFetch<{ ok: boolean; reversed: boolean; message: string }>(
        `/api/admin/matches/${matchId}/void`,
        { method: 'POST' },
      );
      setMessage({
        type: 'success',
        text: res.message || 'Match voided successfully',
      });
      setVoidModalMatchId(null);
      await fetchReports();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'Failed to void match',
      });
    } finally {
      setVoiding(false);
    }
  };

  const handleTriggerSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiFetch<{ ok: boolean; result: unknown }>('/api/admin/problems/sync', {
        method: 'POST',
      });
      setSyncResult(res.result);
      setMessage({ type: 'success', text: 'Problem catalog sync completed successfully!' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof ApiError ? err.message : 'Catalog sync failed',
      });
    } finally {
      setSyncing(false);
    }
  };

  if (!user || user.role !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 font-mono">
        <ShieldAlert className="w-16 h-16 text-rose-500 mb-4 animate-pulse" />
        <h1 className="text-2xl font-black text-white mb-2">ACCESS RESTRICTED</h1>
        <p className="text-xs text-slate-400 max-w-md">
          Administrator clearance required to access the moderation command center.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-cyan-500/20 mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <ShieldAlert className="w-7 h-7 text-violet-400 drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]" />
            <span>OPERATIONS & MODERATION CENTER</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Review abuse reports, void disputed duels, inspect sheets, and synchronize problem
            catalog.
          </p>
        </div>
      </div>

      {/* Alert Banner */}
      {message && (
        <div
          className={`p-4 rounded-2xl mb-6 flex items-center justify-between border ${
            message.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
              : 'bg-rose-950/60 border-rose-500/50 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.2)]'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-bold">
            {message.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
            <span>{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="text-slate-400 hover:text-white text-xs font-bold uppercase px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-cyan-500/20 mb-6">
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition flex items-center gap-2 border-b-2 uppercase tracking-wider ${
            activeTab === 'reports'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-4 h-4" />
          Reports Queue
        </button>
        <button
          onClick={() => setActiveTab('sheets')}
          className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition flex items-center gap-2 border-b-2 uppercase tracking-wider ${
            activeTab === 'sheets'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          Level Sheets
        </button>
        <button
          onClick={() => setActiveTab('sync')}
          className={`px-4 py-2.5 text-xs font-bold rounded-t-xl transition flex items-center gap-2 border-b-2 uppercase tracking-wider ${
            activeTab === 'sync'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <RefreshCw className="w-4 h-4" />
          Catalog Sync
        </button>
      </div>

      {/* Reports Tab */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1.5 bg-slate-950 p-1 rounded-xl border border-cyan-500/20 text-xs">
              {(['OPEN', 'RESOLVED', 'DISMISSED', 'ALL'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setReportFilter(filter)}
                  className={`px-3 py-1.5 rounded-lg font-bold transition uppercase ${
                    reportFilter === filter
                      ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
            <button
              onClick={() => void fetchReports()}
              disabled={loadingReports}
              className="p-2 text-slate-400 hover:text-cyan-300 hover:bg-slate-900 rounded-lg transition"
              title="Refresh reports"
            >
              <RefreshCw className={`w-4 h-4 ${loadingReports ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loadingReports ? (
            <div className="flex justify-center py-16">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <div className="neon-card rounded-2xl p-12 text-center text-xs text-slate-400">
              No {reportFilter === 'ALL' ? '' : reportFilter.toLowerCase()} reports in queue.
            </div>
          ) : (
            <div className="space-y-4">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="neon-card rounded-2xl p-5 hover:border-cyan-500/50 transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase border ${
                            report.status === 'OPEN'
                              ? 'bg-amber-950/80 text-amber-400 border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                              : report.status === 'RESOLVED'
                                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {report.status}
                        </span>
                        <span className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(report.createdAt).toLocaleString()}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          by <strong className="text-white">{report.reporterDisplayName}</strong>
                        </span>
                      </div>

                      <p className="text-xs text-slate-200 font-medium mb-3 bg-slate-950/70 p-3 rounded-xl border border-cyan-500/15">
                        "{report.reason}"
                      </p>

                      {report.matchSummary && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <span>
                            Match:{' '}
                            <code className="text-cyan-400">{report.matchId.slice(0, 8)}</code>
                          </span>
                          <span>•</span>
                          <span className="text-slate-300 font-bold">
                            {report.matchSummary.mode}
                          </span>
                          <span>•</span>
                          <span>
                            Status:{' '}
                            <span className="text-white font-bold">
                              {report.matchSummary.status}
                            </span>
                            {report.matchSummary.endReason && ` (${report.matchSummary.endReason})`}
                          </span>
                          <span>•</span>
                          <span>
                            Duelists:{' '}
                            {report.matchSummary.players.map((p, idx) => (
                              <span key={p.userId}>
                                {idx > 0 && ' vs '}
                                <strong className="text-cyan-300">{p.handleNorm}</strong> ({p.score}{' '}
                                pts)
                              </span>
                            ))}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 shrink-0">
                      {report.status === 'OPEN' && (
                        <>
                          <button
                            onClick={() => handleUpdateStatus(report.id, 'RESOLVED')}
                            disabled={actionLoading === report.id}
                            className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50 uppercase"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Resolve
                          </button>
                          <button
                            onClick={() => handleUpdateStatus(report.id, 'DISMISSED')}
                            disabled={actionLoading === report.id}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50 uppercase"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Dismiss
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setVoidModalMatchId(report.matchId)}
                        className="px-3.5 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold flex items-center gap-1.5 transition uppercase"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        Void Match
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Level Sheets Tab */}
      {activeTab === 'sheets' && (
        <div>
          {loadingSheets ? (
            <div className="flex justify-center py-16">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sheets.map((sheet) => (
                <div key={sheet.id} className="neon-card rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-white text-base">{sheet.name}</h3>
                    <span
                      className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                        sheet.isActive
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {sheet.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mb-4 line-clamp-2">
                    {sheet.description || 'No description'}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/70 p-3 rounded-xl border border-cyan-500/15">
                    <div>
                      Rating:{' '}
                      <strong className="text-white">
                        {sheet.minRating}–{sheet.maxRating}
                      </strong>
                    </div>
                    <div>
                      Problems: <strong className="text-cyan-400">{sheet.problemCount}</strong>
                    </div>
                    <div>
                      Questions: <strong className="text-white">{sheet.questionCount}</strong>
                    </div>
                    <div>
                      Min Solves: <strong className="text-white">{sheet.minSolvedCount}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Catalog Sync Tab */}
      {activeTab === 'sync' && (
        <div className="neon-card rounded-2xl p-7 max-w-2xl">
          <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <span>Codeforces Problem Catalog Ingestion</span>
          </h2>
          <p className="text-xs text-slate-400 mb-6 leading-relaxed">
            Pulls all programming problems and solved statistics from Codeforces API and updates the
            local problem database for smart problem selection.
          </p>

          <button
            onClick={() => void handleTriggerSync()}
            disabled={syncing}
            className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-[0_0_20px_rgba(6,182,212,0.4)] transition disabled:opacity-50 uppercase tracking-wider"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing Catalog...' : 'Trigger Immediate Sync'}
          </button>

          {Boolean(syncResult) && (
            <div className="mt-6 bg-slate-950 p-4 rounded-xl border border-cyan-500/20 text-xs text-cyan-300 overflow-x-auto">
              <pre>{JSON.stringify(syncResult, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Void Match Confirmation Modal */}
      {voidModalMatchId && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#16060c] border border-rose-500/40 rounded-2xl max-w-md w-full p-6 shadow-[0_0_35px_rgba(244,63,94,0.25)]">
            <div className="flex items-center gap-3 text-rose-400 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-bold text-white">VOID MATCH & REVERSE RATINGS?</h2>
            </div>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              This action will mark match{' '}
              <code className="text-rose-400">{voidModalMatchId.slice(0, 8)}</code> as{' '}
              <strong className="text-rose-400">VOIDED</strong>. Rating deltas will be atomically
              reversed and leaderboards refreshed.
            </p>
            <div className="flex justify-end gap-3 text-xs">
              <button
                onClick={() => setVoidModalMatchId(null)}
                disabled={voiding}
                className="px-4 py-2 bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded-xl font-bold uppercase transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleVoidMatch(voidModalMatchId)}
                disabled={voiding}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(244,63,94,0.4)] transition disabled:opacity-50"
              >
                {voiding ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
