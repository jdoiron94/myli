import type { z } from 'zod';
import type { Db } from '../db/database.ts';
import type { Logger } from '../logger.ts';
import type { Mailer } from '../mail/mailer.ts';

/** What handlers use besides their payload. `main.ts` builds it; tests pass fakes. */
export interface JobServices {
  db: Db;
  /** `null` when email is off (SMTP_HOST isn't set). */
  mailer: Mailer | null;
}

export interface JobContext {
  services: JobServices;
  /** Tagged with the job's ID, type and attempt number. */
  logger: Logger;
  jobId: number;
  /** 1 on the first run, then 2, 3, … on retries. */
  attempt: number;
}

/**
 * A kind of background job. Handlers must be idempotent: a job can run more than once, for example
 * when the process stops after the handler finished but before the job was marked as done.
 */
export interface JobDefinition<TPayload extends z.ZodType = z.ZodType> {
  /** Stored in `job.type`. Never rename one that may still have rows; add a new type instead. */
  type: string;
  /** Validated when the job is queued and again before it runs. */
  payload: TPayload;
  // Method syntax on purpose: it lets a definition with a specific payload type be stored in a
  // list of `JobDefinition`s.
  handle(payload: z.output<TPayload>, context: JobContext): Promise<void>;
}

export function defineJob<TPayload extends z.ZodType>(
  definition: JobDefinition<TPayload>,
): JobDefinition<TPayload> {
  return definition;
}
