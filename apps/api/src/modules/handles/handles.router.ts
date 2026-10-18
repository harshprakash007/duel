import express, { type Request, type Response, type Router } from 'express';
import { LinkStartInputSchema } from '@duel/shared';
import type { HandlesService } from './handles.service';
import { requireUser } from '../auth/auth.middleware';

export function createHandlesRouter(handlesService: HandlesService): Router {
  const router = express.Router();

  router.post('/link/start', requireUser, async (req: Request, res: Response, next) => {
    try {
      const input = LinkStartInputSchema.parse(req.body);
      const result = await handlesService.linkStart(req.user!.sub, input);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/link/verify', requireUser, async (req: Request, res: Response, next) => {
    try {
      const result = await handlesService.linkVerify(req.user!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireUser, async (req: Request, res: Response, next) => {
    try {
      const result = await handlesService.getMyHandle(req.user!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
