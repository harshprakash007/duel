import express, { type Request, type Response, type Router } from 'express';
import { UserMatchesQuerySchema } from '@duel/shared';
import type { UsersService } from './users.service';
import { AppError } from '../../lib/errors';
import { requireUser } from '../auth/auth.middleware';

export function createUsersRouter(
  usersService: UsersService,
  cookieName?: string,
  cookieSecure?: boolean,
): Router {
  const router = express.Router();

  router.delete('/me', requireUser, async (req: Request, res: Response, next) => {
    try {
      await usersService.deleteAccount(req.user!.sub);
      if (cookieName) {
        res.clearCookie(cookieName, {
          httpOnly: true,
          secure: cookieSecure ?? false,
          sameSite: 'lax',
          path: '/',
        });
      }
      res.status(200).json({ ok: true, message: 'Account deleted' });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:handle', async (req: Request, res: Response, next) => {
    try {
      const handle = typeof req.params.handle === 'string' ? req.params.handle : '';
      if (!handle) {
        throw new AppError('BAD_REQUEST', 'Handle parameter is required');
      }
      const profile = await usersService.getUserProfile(handle);
      res.status(200).json(profile);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:handle/matches', async (req: Request, res: Response, next) => {
    try {
      const handle = typeof req.params.handle === 'string' ? req.params.handle : '';
      if (!handle) {
        throw new AppError('BAD_REQUEST', 'Handle parameter is required');
      }
      const query = UserMatchesQuerySchema.parse(req.query);
      const matches = await usersService.getUserMatches(handle, query);
      res.status(200).json(matches);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
