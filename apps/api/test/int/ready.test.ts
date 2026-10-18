import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index';
import { startServer, type RunningServer } from '../../src/server';
import { testEnv } from './env';

describe('readiness against real Postgres + Redis', () => {
  let srv: RunningServer;
  beforeAll(async () => {
    srv = await startServer(loadConfig(testEnv()));
  });
  afterAll(async () => {
    await srv.close();
  });

  it('/readyz is ok', async () => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/readyz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: 'ok', redis: 'ok' });
  });
});
