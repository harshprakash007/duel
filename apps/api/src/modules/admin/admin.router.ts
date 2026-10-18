import express, { type Request, type Response, type Router } from 'express';
import { CreateSheetInputSchema, UpdateSheetInputSchema } from '@duel/shared';
import { requireAdmin } from '../auth/auth.middleware';
import type { SheetsService } from '../sheets/sheets.service';
import type { CatalogSyncService } from '../problems/catalog-sync.service';

export function createAdminRouter(
  sheetsService: SheetsService,
  catalogSyncService: CatalogSyncService,
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

  return router;
}
