import { pino, type Logger } from 'pino';
import type { Config } from '../config/index';

export type { Logger };

export function createLogger(config: Pick<Config, 'logLevel' | 'isProd' | 'instanceId'>): Logger {
  return pino({
    level: config.logLevel,
    base: { instance: config.instanceId },
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'password',
        'passwordHash',
        '*.password',
      ],
      censor: '[redacted]',
    },
  });
}
