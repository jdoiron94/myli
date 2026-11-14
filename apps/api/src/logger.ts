import { type DestinationStream, type Logger, pino } from 'pino';
import type { Env } from './env.ts';

export type { Logger };

/**
 * JSON logs, one object per line, to stdout (or to `destination` in tests).
 * `pnpm dev` pipes them through pino-pretty; production keeps them as JSON.
 */
export function createLogger(level: Env['LOG_LEVEL'], destination?: DestinationStream): Logger {
  return pino({ level, timestamp: pino.stdTimeFunctions.isoTime }, destination);
}
