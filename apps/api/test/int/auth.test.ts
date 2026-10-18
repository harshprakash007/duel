import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../../src/config/index';
import { startServer, type RunningServer } from '../../src/server';
import { testEnv } from './env';

function getCookies(res: request.Response): string[] {
  const c = res.headers['set-cookie'];
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}

describe('Auth API Integration', () => {
  let srv: RunningServer;

  beforeAll(async () => {
    srv = await startServer(loadConfig(testEnv()));
    // Clean user table
    await srv.prisma.user.deleteMany();
  });

  afterAll(async () => {
    await srv.close();
  });

  it('registers a new user and sets session cookie', async () => {
    const res = await request(srv.server).post('/api/auth/register').send({
      email: 'alice@example.com',
      password: 'Password123!',
      displayName: 'Alice',
    });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'USER',
    });

    const cookies = getCookies(res);
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies[0]).toContain('duel_session=');
    expect(cookies[0]).toContain('HttpOnly');
  });

  it('rejects registration with duplicate email', async () => {
    const res = await request(srv.server).post('/api/auth/register').send({
      email: 'alice@example.com',
      password: 'Password123!',
      displayName: 'Alice Duplicate',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('logs in with correct credentials and returns user and cookie', async () => {
    const res = await request(srv.server).post('/api/auth/login').send({
      email: 'alice@example.com',
      password: 'Password123!',
    });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('alice@example.com');
    const cookies = getCookies(res);
    expect(cookies[0]).toContain('duel_session=');
  });

  it('rejects login with wrong password', async () => {
    const res = await request(srv.server).post('/api/auth/login').send({
      email: 'alice@example.com',
      password: 'WrongPassword!',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('authenticates /api/auth/me using session cookie', async () => {
    const loginRes = await request(srv.server).post('/api/auth/login').send({
      email: 'alice@example.com',
      password: 'Password123!',
    });

    const loginCookies = getCookies(loginRes);
    const cookie = loginCookies[0]!;

    const meRes = await request(srv.server).get('/api/auth/me').set('Cookie', cookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe('alice@example.com');
    expect(meRes.body.user.displayName).toBe('Alice');
  });

  it('rejects /api/auth/me without authentication', async () => {
    const res = await request(srv.server).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('clears cookie on logout', async () => {
    const res = await request(srv.server).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const cookie = res.headers['set-cookie']?.[0];
    expect(cookie).toMatch(/duel_session=;/);
  });
});
