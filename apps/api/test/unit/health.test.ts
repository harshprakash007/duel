import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { loadConfig } from '../../src/config/index';
import { createLogger } from '../../src/lib/logger';
import { createMetrics } from '../../src/lib/metrics';

const config = loadConfig({
  DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  LOG_LEVEL: 'silent',
  CORS_ORIGIN: 'http://allowed.test',
});

function build(dbOk: boolean, redisOk: boolean) {
  return createApp({
    config,
    logger: createLogger(config),
    metrics: createMetrics(),
    health: {
      db: async () => {
        if (!dbOk) throw new Error('db down');
      },
      redis: async () => {
        if (!redisOk) throw new Error('redis down');
      },
    },
  });
}

describe('health endpoints', () => {
  it('/healthz is always ok', async () => {
    const res = await request(build(false, false)).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('/readyz reports dependency status', async () => {
    expect((await request(build(true, true)).get('/readyz')).status).toBe(200);
    const res = await request(build(true, false)).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, db: 'ok', redis: 'down' });
  });

  it('/metrics exposes prometheus text', async () => {
    const res = await request(build(true, true)).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('cf_requests_total');
  });

  it('unknown routes use the error shape', async () => {
    const res = await request(build(true, true)).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('rejects mutating requests from foreign origins', async () => {
    const res = await request(build(true, true)).post('/api/x').set('Origin', 'http://evil.test');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
