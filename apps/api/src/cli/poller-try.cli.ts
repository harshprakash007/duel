import { CfClient } from '@duel/cf-client';
import { loadConfig } from '../config/index';
import { loadDotEnv } from '../lib/dotenv';
import { createLogger } from '../lib/logger';
import { PollerService } from '../modules/poller/poller.service';

function parseArgs(): { handleA: string; handleB: string; problemKey: string } {
  const args = process.argv.slice(2);
  let handleA = 'tourist';
  let handleB = 'petr';
  let problemKey = '4A';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--a' && args[i + 1]) {
      handleA = args[++i]!;
    } else if (arg === '--b' && args[i + 1]) {
      handleB = args[++i]!;
    } else if (arg === '--problem' && args[i + 1]) {
      problemKey = args[++i]!;
    }
  }

  return { handleA, handleB, problemKey };
}

function parseProblem(key: string): { contestId: number; index: string } {
  const match = key.match(/^(\d+)([A-Za-z0-9]+)$/);
  if (!match) {
    throw new Error(`Invalid problem format "${key}". Expected format like "4A" or "1234B".`);
  }
  return {
    contestId: parseInt(match[1]!, 10),
    index: match[2]!.toUpperCase(),
  };
}

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const logger = createLogger(config);
  const { handleA, handleB, problemKey } = parseArgs();
  const { contestId, index } = parseProblem(problemKey);

  console.log('\n======================================================');
  console.log('       DUEL SUBMISSION POLLER CLI (Risk Gate)');
  console.log('======================================================\n');
  console.log(`Target Problem: ${contestId}${index}`);
  console.log(`Player A Handle: ${handleA}`);
  console.log(`Player B Handle: ${handleB}`);
  console.log(`CF Base URL: ${config.cf.baseUrl}`);
  console.log(`Poll Interval: ${config.poller.intervalMs / 1000}s\n`);

  const cfClient = new CfClient({
    baseUrl: config.cf.baseUrl,
    userAgent: config.cf.userAgent,
    maxRps: config.cf.maxRps,
    timeoutMs: config.cf.timeoutMs,
  });

  console.log('Querying baseline submissions from Codeforces...');
  let baselineA = 0n;
  let baselineB = 0n;

  try {
    const subsA = await cfClient.userStatus(handleA, 1, 1, 'high');
    if (subsA[0]) baselineA = subsA[0].id;
    console.log(`Baseline for ${handleA}: submission #${baselineA}`);
  } catch (err) {
    console.warn(`Could not fetch baseline for ${handleA} (may be new or offline): ${String(err)}`);
  }

  try {
    const subsB = await cfClient.userStatus(handleB, 1, 1, 'high');
    if (subsB[0]) baselineB = subsB[0].id;
    console.log(`Baseline for ${handleB}: submission #${baselineB}`);
  } catch (err) {
    console.warn(`Could not fetch baseline for ${handleB} (may be new or offline): ${String(err)}`);
  }

  const poller = new PollerService(cfClient, config, logger);

  const startTime = Date.now();
  poller.register({
    matchId: 'cli-match',
    questionIdx: 0,
    userId: 'user-a',
    handleNorm: handleA,
    contestId,
    index,
    baselineId: baselineA,
    startedAtMs: startTime,
    deadlineAtMs: startTime + 3600 * 1000,
  });

  poller.register({
    matchId: 'cli-match',
    questionIdx: 0,
    userId: 'user-b',
    handleNorm: handleB,
    contestId,
    index,
    baselineId: baselineB,
    startedAtMs: startTime,
    deadlineAtMs: startTime + 3600 * 1000,
  });

  poller.addListener({
    onPending: (event) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `[+${elapsed}s] ⏳ PENDING: Submission #${event.submissionId} by ${event.handleNorm} for ${event.contestId}${event.index} is being evaluated...`,
      );
    },
    onVerdict: (event) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const latency = ((event.detectedAtMs - event.creationTimeSeconds * 1000) / 1000).toFixed(1);
      console.log(
        `[+${elapsed}s] 🎯 VERDICT: Submission #${event.submissionId} by ${event.handleNorm} => ${event.verdict} (${event.passedTestCount} tests passed, detection latency: ${latency}s)`,
      );
    },
  });

  await poller.start();

  console.log('\n------------------------------------------------------');
  console.log(`Poller is active! Submit on problem ${contestId}${index} on Codeforces now.`);
  console.log('Press Ctrl+C to exit.');
  console.log('------------------------------------------------------\n');

  const shutdown = () => {
    console.log('\nShutting down poller...');
    poller.stop();
    cfClient.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal CLI error:', err);
  process.exit(1);
});
