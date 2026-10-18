import { loadDotEnv } from './lib/dotenv';
import { ConfigError, loadConfig } from './config/index';
import { startServer } from './server';

async function main(): Promise<void> {
  loadDotEnv();
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  const running = await startServer(config);
  const shutdown = (signal: string) => {
    running.logger.info({ signal }, 'signal received');
    const timer = setTimeout(() => process.exit(1), config.http.shutdownGraceMs);
    timer.unref();
    running
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        running.logger.error({ err }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
