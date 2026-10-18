import { CfClient } from '../src/client';

async function runProbe() {
  const baseUrl = process.env.CF_BASE_URL || 'https://codeforces.com/api';
  const userAgent =
    process.env.CF_USER_AGENT || 'Duel/0.1 (+https://github.com/duel; probe script)';

  console.log(`[CF Probe] Probing Codeforces API at: ${baseUrl}`);
  console.log(`[CF Probe] User-Agent: ${userAgent}`);

  const client = new CfClient({
    baseUrl,
    userAgent,
    maxRps: 2,
    timeoutMs: 30_000,
  });

  const results: Array<{ endpoint: string; durationMs: number; ok: boolean; info?: string }> = [];

  // 1. problemset.problems
  try {
    console.log('[CF Probe] 1/4 Fetching problemset.problems...');
    const t0 = Date.now();
    const data = await client.problemsetProblems();
    const duration = Date.now() - t0;
    results.push({
      endpoint: 'problemset.problems',
      durationMs: duration,
      ok: true,
      info: `Received ${data.problems.length} problems, ${data.problemStatistics.length} statistics entries`,
    });
  } catch (err: unknown) {
    results.push({
      endpoint: 'problemset.problems',
      durationMs: 0,
      ok: false,
      info: (err as Error).message,
    });
  }

  // 2. problemset.recentStatus
  try {
    console.log('[CF Probe] 2/4 Fetching problemset.recentStatus...');
    const t0 = Date.now();
    const subs = await client.problemsetRecentStatus(10);
    const duration = Date.now() - t0;
    const maxId = subs.length > 0 ? subs[0]?.id.toString() : 'none';
    results.push({
      endpoint: 'problemset.recentStatus(10)',
      durationMs: duration,
      ok: true,
      info: `Received ${subs.length} submissions (max ID: ${maxId})`,
    });
  } catch (err: unknown) {
    results.push({
      endpoint: 'problemset.recentStatus',
      durationMs: 0,
      ok: false,
      info: (err as Error).message,
    });
  }

  // 3. user.info
  try {
    console.log('[CF Probe] 3/4 Fetching user.info...');
    const t0 = Date.now();
    const users = await client.userInfo(['tourist']);
    const duration = Date.now() - t0;
    const u = users[0];
    results.push({
      endpoint: 'user.info(tourist)',
      durationMs: duration,
      ok: true,
      info: `Handle: ${u?.handle}, Rating: ${u?.rating}, Rank: ${u?.rank}`,
    });
  } catch (err: unknown) {
    results.push({
      endpoint: 'user.info',
      durationMs: 0,
      ok: false,
      info: (err as Error).message,
    });
  }

  // 4. user.status
  try {
    console.log('[CF Probe] 4/4 Fetching user.status...');
    const t0 = Date.now();
    const subs = await client.userStatus('tourist', 1, 5);
    const duration = Date.now() - t0;
    results.push({
      endpoint: 'user.status(tourist, 1, 5)',
      durationMs: duration,
      ok: true,
      info: `Received ${subs.length} submissions for tourist`,
    });
  } catch (err: unknown) {
    results.push({
      endpoint: 'user.status',
      durationMs: 0,
      ok: false,
      info: (err as Error).message,
    });
  }

  client.destroy();

  console.log('\n--- Probe Results ---');
  let allOk = true;
  for (const r of results) {
    const status = r.ok ? '✓ PASS' : '✗ FAIL';
    console.log(`${status} [${r.endpoint}] (${r.durationMs}ms) - ${r.info}`);
    if (!r.ok) allOk = false;
  }

  if (!allOk) {
    console.error(
      '\n[CF Probe] FAILED: Some Codeforces endpoints could not be reached or validated.',
    );
    process.exit(1);
  } else {
    console.log(
      '\n[CF Probe] SUCCESS: All Codeforces endpoints responded and validated correctly.',
    );
  }
}

runProbe().catch((err) => {
  console.error('[CF Probe] Fatal error:', err);
  process.exit(1);
});
