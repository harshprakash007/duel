import { describe, expect, it } from 'vitest';
import { loadConfig, ConfigError } from '../../src/config/index';
import { MATCH_DEFAULTS, QUESTION_CAPS_DEFAULT, SCORING_DEFAULTS } from '@duel/shared';

const base = {
  DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('applies §21 defaults', () => {
    const c = loadConfig(base);
    expect(c.cf.maxRps).toBe(2);
    expect(c.cf.timeoutMs).toBe(30_000);
    expect(c.cf.degradedAfterFailures).toBe(4);
    expect(c.poller.intervalMs).toBe(5_000);
    expect(c.match.countdownMs).toBe(MATCH_DEFAULTS.countdownMs);
    expect(c.match.questionCaps).toEqual(QUESTION_CAPS_DEFAULT);
    expect(c.scoring).toEqual(SCORING_DEFAULTS);
    expect(c.elo.kNew).toBe(40);
    expect(c.matchmaking.window).toEqual({ base: 100, step: 50, stepEverySec: 5, max: 600 });
    expect(c.leaderboard.minRankedMatches).toBe(5);
    expect(c.handles.verifyWindowMs).toBe(300_000);
    expect(c.auth.cookieSecure).toBe(false);
  });

  it('reads overrides', () => {
    const c = loadConfig({
      ...base,
      CF_MAX_RPS: '1.5',
      CORS_ORIGIN: 'https://a.test, https://b.test',
      QUESTION_CAPS_JSON: '[{"belowRating":null,"capMs":1000}]',
      NODE_ENV: 'production',
    });
    expect(c.cf.maxRps).toBe(1.5);
    expect(c.http.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(c.match.questionCaps).toEqual([{ belowRating: null, capMs: 1000 }]);
    expect(c.auth.cookieSecure).toBe(true);
  });

  it('rejects missing or weak secrets', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(ConfigError);
    expect(() => loadConfig({ REDIS_URL: 'redis://x' })).toThrow(ConfigError);
  });

  it('rejects invalid caps JSON', () => {
    expect(() => loadConfig({ ...base, QUESTION_CAPS_JSON: 'nope' })).toThrow(ConfigError);
  });
});
