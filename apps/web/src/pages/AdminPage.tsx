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
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <ShieldAlert className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold text-gray-100 mb-2">Access Denied</h1>
        <p className="text-gray-400 max-w-md">
          Administrator privileges are required to view this moderation portal.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between pb-6 border-b border-gray-800 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-indigo-400" />
            Admin Moderation & Operations
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Review abuse reports, void suspicious matches, manage level sheets, and synchronize
            problem catalog.
          </p>
        </div>
      </div>

      {/* Alert Banner */}
      {message && (
        <div
          className={`p-4 rounded-xl mb-6 flex items-center justify-between ${
            message.type === 'success'
              ? 'bg-emerald-950/60 border border-emerald-800/80 text-emerald-300'
              : 'bg-rose-950/60 border border-rose-800/80 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
            {message.text}
          </div>
          <button
            onClick={() => setMessage(null)}
            className="text-gray-400 hover:text-gray-200 text-xs font-semibold px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 mb-6">
        <button
          onClick={() => setActiveTab('reports')}
          className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg transition flex items-center gap-2 border-b-2 ${
            activeTab === 'reports'
              ? 'border-indigo-500 text-indigo-400 bg-gray-900/60'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <FileText className="w-4 h-4" />
          Abuse Reports
        </button>
        <button
          onClick={() => setActiveTab('sheets')}
          className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg transition flex items-center gap-2 border-b-2 ${
            activeTab === 'sheets'
              ? 'border-indigo-500 text-indigo-400 bg-gray-900/60'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          Level Sheets
        </button>
        <button
          onClick={() => setActiveTab('sync')}
          className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg transition flex items-center gap-2 border-b-2 ${
            activeTab === 'sync'
              ? 'border-indigo-500 text-indigo-400 bg-gray-900/60'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <RefreshCw className="w-4 h-4" />
          Problem Catalog Sync
        </button>
      </div>

      {/* Reports Tab */}
      {activeTab === 'reports' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1.5 bg-gray-900 p-1 rounded-lg border border-gray-800 text-xs font-medium">
              {(['OPEN', 'RESOLVED', 'DISMISSED', 'ALL'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setReportFilter(filter)}
                  className={`px-3 py-1.5 rounded-md transition ${
                    reportFilter === filter
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
            <button
              onClick={() => void fetchReports()}
              disabled={loadingReports}
              className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-900 rounded-lg transition"
              title="Refresh reports"
            >
              <RefreshCw className={`w-4 h-4 ${loadingReports ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loadingReports ? (
            <div className="flex justify-center py-16">
              <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-12 text-center text-gray-400">
              No {reportFilter === 'ALL' ? '' : reportFilter.toLowerCase()} abuse reports found.
            </div>
          ) : (
            <div className="space-y-4">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="bg-gray-900/70 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase ${
                            report.status === 'OPEN'
                              ? 'bg-amber-950/80 text-amber-400 border border-amber-800/80'
                              : report.status === 'RESOLVED'
                                ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/80'
                                : 'bg-gray-800 text-gray-400 border border-gray-700'
                          }`}
                        >
                          {report.status}
                        </span>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(report.createdAt).toLocaleString()}
                        </span>
                        <span className="text-xs text-gray-400">
                          by <strong className="text-gray-200">{report.reporterDisplayName}</strong>
                        </span>
                      </div>

                      <p className="text-sm text-gray-200 font-medium mb-3 bg-gray-950/50 p-3 rounded-lg border border-gray-800/80">
                        "{report.reason}"
                      </p>

                      {report.matchSummary && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                          <span>
                            Match ID:{' '}
                            <code className="text-indigo-400">{report.matchId.slice(0, 8)}</code>
                          </span>
                          <span>•</span>
                          <span className="font-semibold text-gray-300">
                            {report.matchSummary.mode}
                          </span>
                          <span>•</span>
                          <span>
                            Status:{' '}
                            <span className="text-gray-200">{report.matchSummary.status}</span>
                            {report.matchSummary.endReason && ` (${report.matchSummary.endReason})`}
                          </span>
                          <span>•</span>
                          <span>
                            Players:{' '}
                            {report.matchSummary.players.map((p, idx) => (
                              <span key={p.userId}>
                                {idx > 0 && ' vs '}
                                <strong className="text-gray-200">{p.handleNorm}</strong> ({p.score}{' '}
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
                            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Resolve
                          </button>
                          <button
                            onClick={() => handleUpdateStatus(report.id, 'DISMISSED')}
                            disabled={actionLoading === report.id}
                            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Dismiss
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setVoidModalMatchId(report.matchId)}
                        className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/80 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
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
              <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sheets.map((sheet) => (
                <div
                  key={sheet.id}
                  className="bg-gray-900/70 border border-gray-800 rounded-xl p-5"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-gray-100 text-base">{sheet.name}</h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        sheet.isActive
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-gray-800 text-gray-400 border border-gray-700'
                      }`}
                    >
                      {sheet.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mb-4">
                    {sheet.description || 'No description'}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-300 bg-gray-950/60 p-3 rounded-lg border border-gray-800/80">
                    <div>
                      Rating Band:{' '}
                      <strong className="text-white">
                        {sheet.minRating}–{sheet.maxRating}
                      </strong>
                    </div>
                    <div>
                      Problems: <strong className="text-indigo-400">{sheet.problemCount}</strong>
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
        <div className="bg-gray-900/70 border border-gray-800 rounded-xl p-6 max-w-2xl">
          <h2 className="text-lg font-bold text-gray-100 mb-2">Codeforces Problem Catalog Sync</h2>
          <p className="text-sm text-gray-400 mb-6">
            Pulls all programming problems and solved statistics from Codeforces API and updates the
            local problem database.
          </p>

          <button
            onClick={() => void handleTriggerSync()}
            disabled={syncing}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing Catalog...' : 'Trigger Immediate Sync'}
          </button>

          {Boolean(syncResult) && (
            <div className="mt-6 bg-gray-950 p-4 rounded-xl border border-gray-800 text-xs font-mono text-gray-300 overflow-x-auto">
              <pre>{JSON.stringify(syncResult, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Void Match Confirmation Modal */}
      {voidModalMatchId && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-bold text-gray-100">Void Match & Reverse Ratings?</h2>
            </div>
            <p className="text-sm text-gray-300 mb-4 leading-relaxed">
              This action will mark match{' '}
              <code className="text-rose-400 font-mono">{voidModalMatchId.slice(0, 8)}</code> as{' '}
              <strong className="text-rose-400">VOIDED</strong>. If the match was ranked, it will{' '}
              <strong className="text-amber-400">atomically reverse rating deltas</strong> for both
              players and resync leaderboards.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setVoidModalMatchId(null)}
                disabled={voiding}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleVoidMatch(voidModalMatchId)}
                disabled={voiding}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
              >
                {voiding ? 'Voiding...' : 'Confirm Void Match'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
