import express, { type Request, type Response, type Router } from 'express';
import {
  CreateSheetInputSchema,
  UpdateSheetInputSchema,
  UpdateReportInputSchema,
} from '@duel/shared';
import { requireAdmin } from '../auth/auth.middleware';
import type { SheetsService } from '../sheets/sheets.service';
import type { CatalogSyncService } from '../problems/catalog-sync.service';
import type { ReportsService } from '../reports/reports.service';
import type { RatingsService } from '../ratings/ratings.service';
import { AppError } from '../../lib/errors';
import type { ReportStatus } from '../../generated/prisma/client';

export function createAdminRouter(
  sheetsService: SheetsService,
  catalogSyncService: CatalogSyncService,
  reportsService?: ReportsService,
  ratingsService?: RatingsService,
): Router {
  const router = express.Router();

  // All admin routes require admin privileges
  router.use(requireAdmin);

  // GET /api/admin/sheets: list all sheets including inactive
  router.get('/sheets', async (_req: Request, res: Response, next) => {
    try {
      const sheets = await sheetsService.listSheets(true);
      res.status(200).json({ sheets });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/admin/sheets: create new level sheet
  router.post('/sheets', async (req: Request, res: Response, next) => {
    try {
      const input = CreateSheetInputSchema.parse(req.body);
      const sheet = await sheetsService.createSheet(input);
      res.status(201).json({ sheet });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/admin/sheets/:id: update level sheet
  router.patch('/sheets/:id', async (req: Request, res: Response, next) => {
    try {
      const input = UpdateSheetInputSchema.parse(req.body);
      const sheet = await sheetsService.updateSheet(req.params.id as string, input);
      res.status(200).json({ sheet });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/admin/problems/sync: manually trigger problem catalog sync from Codeforces
  router.post('/problems/sync', async (_req: Request, res: Response, next) => {
    try {
      const result = await catalogSyncService.sync();
      res.status(200).json({ ok: true, result });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/admin/reports: list reports
  router.get('/reports', async (req: Request, res: Response, next) => {
    try {
      if (!reportsService) throw new AppError('INTERNAL', 'Reports service not available');
      const status =
        typeof req.query.status === 'string' ? (req.query.status as ReportStatus) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
      const result = await reportsService.listReports({ status, limit, offset });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/admin/reports/:id: update report status
  router.patch('/reports/:id', async (req: Request, res: Response, next) => {
    try {
      if (!reportsService) throw new AppError('INTERNAL', 'Reports service not available');
      const input = UpdateReportInputSchema.parse(req.body);
      const updated = await reportsService.updateReportStatus(req.params.id as string, input);
      res.status(200).json({ report: updated });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/admin/matches/:id/void: void match and reverse ratings
  router.post('/matches/:id/void', async (req: Request, res: Response, next) => {
    try {
      if (!ratingsService) throw new AppError('INTERNAL', 'Ratings service not available');
      const matchId = req.params.id as string;
      const result = await ratingsService.voidMatchRatings(matchId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
