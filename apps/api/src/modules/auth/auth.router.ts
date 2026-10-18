import express, { type Request, type Response, type Router } from 'express';
import { RegisterInputSchema, LoginInputSchema } from '@duel/shared';
import type { AuthService } from './auth.service';
import type { Config } from '../../config/index';
import { requireUser } from './auth.middleware';

export function createAuthRouter(authService: AuthService, config: Config): Router {
  const router = express.Router();

  const setCookie = (res: Response, token: string) => {
    res.cookie(config.auth.cookieName, token, {
      httpOnly: true,
      secure: config.auth.cookieSecure,
      sameSite: 'lax',
      maxAge: config.auth.jwtExpiresSec * 1000,
      path: '/',
    });
  };

  router.post('/register', async (req: Request, res: Response, next) => {
    try {
      const input = RegisterInputSchema.parse(req.body);
      const { user, token } = await authService.register(input);
      setCookie(res, token);
      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', async (req: Request, res: Response, next) => {
    try {
      const input = LoginInputSchema.parse(req.body);
      const { user, token } = await authService.login(input);
      setCookie(res, token);
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie(config.auth.cookieName, {
      httpOnly: true,
      secure: config.auth.cookieSecure,
      sameSite: 'lax',
      path: '/',
    });
    res.status(200).json({ ok: true });
  });

  router.get('/me', requireUser, async (req: Request, res: Response, next) => {
    try {
      const user = await authService.getMe(req.user!.sub);
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
