import express, { type Request, type Response, type Router } from 'express';
import type { SheetsService } from './sheets.service';

export function createSheetsRouter(sheetsService: SheetsService): Router {
  const router = express.Router();

  // Public: list all active level sheets with problem counts
  router.get('/', async (_req: Request, res: Response, next) => {
    try {
      const sheets = await sheetsService.listSheets(false);
      res.status(200).json({ sheets });
    } catch (err) {
      next(err);
    }
  });

  // Public: get a single level sheet by slug
  router.get('/:slug', async (req: Request, res: Response, next) => {
    try {
      const sheet = await sheetsService.getBySlug(req.params.slug as string);
      res.status(200).json({ sheet });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
