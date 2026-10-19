import type { Db } from '../../db/prisma';
import type { Logger } from '../../lib/logger';
import { AppError } from '../../lib/errors';
import type { ReportDto, CreateReportInput, UpdateReportInput } from '@duel/shared';
import type { ReportStatus } from '../../generated/prisma/client';

export class ReportsService {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  public async createReport(
    reporterId: string,
    matchId: string,
    input: CreateReportInput,
  ): Promise<{ id: string; status: string }> {
    // 1. Verify match exists
    const match = await this.db.match.findUnique({
      where: { id: matchId },
      include: { players: true },
    });

    if (!match) {
      throw new AppError('NOT_FOUND', 'Match not found');
    }

    // 2. Verify reporter was a participant
    const isParticipant = match.players.some((p) => p.userId === reporterId);
    if (!isParticipant) {
      throw new AppError('FORBIDDEN', 'Only match participants can submit reports');
    }

    // 3. Prevent duplicate reports from the same user for the same match
    const existing = await this.db.report.findFirst({
      where: {
        matchId,
        reporterId,
      },
    });

    if (existing) {
      throw new AppError('CONFLICT', 'You have already submitted a report for this match');
    }

    const report = await this.db.report.create({
      data: {
        matchId,
        reporterId,
        reason: input.reason.trim(),
        status: 'OPEN',
      },
    });

    this.logger.info({ reportId: report.id, matchId, reporterId }, 'Match abuse report submitted');

    return {
      id: report.id,
      status: report.status,
    };
  }

  public async listReports(params: {
    status?: ReportStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ reports: ReportDto[]; total: number }> {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const offset = Math.max(params.offset ?? 0, 0);

    const where = params.status ? { status: params.status } : {};

    const [reports, total] = await Promise.all([
      this.db.report.findMany({
        where,
        include: {
          reporter: {
            select: {
              id: true,
              displayName: true,
              handle: { select: { handle: true } },
            },
          },
          match: {
            include: {
              players: {
                select: {
                  userId: true,
                  handleNorm: true,
                  totalScore: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.db.report.count({ where }),
    ]);

    const dtos: ReportDto[] = reports.map((r) => ({
      id: r.id,
      matchId: r.matchId,
      reporterId: r.reporterId,
      reporterDisplayName: r.reporter.handle?.handle ?? r.reporter.displayName,
      reason: r.reason,
      status: r.status as 'OPEN' | 'RESOLVED' | 'DISMISSED',
      createdAt: r.createdAt.toISOString(),
      matchSummary: {
        mode: r.match.mode as 'RANKED' | 'PRIVATE',
        status: r.match.status,
        endReason: r.match.endReason,
        createdAt: r.match.createdAt.toISOString(),
        players: r.match.players.map((p) => ({
          userId: p.userId,
          handleNorm: p.handleNorm,
          score: p.totalScore,
        })),
      },
    }));

    return { reports: dtos, total };
  }

  public async updateReportStatus(reportId: string, input: UpdateReportInput): Promise<ReportDto> {
    const report = await this.db.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new AppError('NOT_FOUND', 'Report not found');
    }

    const updated = await this.db.report.update({
      where: { id: reportId },
      data: { status: input.status as ReportStatus },
      include: {
        reporter: {
          select: {
            id: true,
            displayName: true,
            handle: { select: { handle: true } },
          },
        },
        match: {
          include: {
            players: {
              select: {
                userId: true,
                handleNorm: true,
                totalScore: true,
              },
            },
          },
        },
      },
    });

    return {
      id: updated.id,
      matchId: updated.matchId,
      reporterId: updated.reporterId,
      reporterDisplayName: updated.reporter.handle?.handle ?? updated.reporter.displayName,
      reason: updated.reason,
      status: updated.status as 'OPEN' | 'RESOLVED' | 'DISMISSED',
      createdAt: updated.createdAt.toISOString(),
      matchSummary: {
        mode: updated.match.mode as 'RANKED' | 'PRIVATE',
        status: updated.match.status,
        endReason: updated.match.endReason,
        createdAt: updated.match.createdAt.toISOString(),
        players: updated.match.players.map((p) => ({
          userId: p.userId,
          handleNorm: p.handleNorm,
          score: p.totalScore,
        })),
      },
    };
  }
}
