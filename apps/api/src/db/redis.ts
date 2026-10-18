import { Redis } from 'ioredis';

export type { Redis };

export function createRedis(url: string, name = 'main'): Redis {
  return new Redis(url, {
    connectionName: `duel-${name}`,
    // Required by BullMQ for blocking connections; harmless elsewhere.
    maxRetriesPerRequest: null,
    enableAutoPipelining: true,
  });
}
