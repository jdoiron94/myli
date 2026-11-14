import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { job } from '../db/schema.ts';
import type { Logger } from '../logger.ts';
import type { JobDefinition, JobServices } from './define.ts';

export const DEFAULT_MAX_ATTEMPTS = 8;

/** 2 s before the second attempt, then 4 s, 8 s, … capped at one hour. */
export function defaultBackoffMs(failedAttempts: number): number {
  return Math.min(2 ** failedAttempts * 1000, 60 * 60 * 1000);
}

/** `last_error` keeps the start of the message; the full error and stack go to the log. */
const MAX_ERROR_LENGTH = 2000;

export interface WorkerOptions {
  /** Passed to every handler. The worker also claims and updates jobs through `services.db`. */
  services: JobServices;
  logger: Logger;
  /** Every job type the worker can run. A job whose type isn't listed is dead-lettered. */
  jobs: readonly JobDefinition[];
  now?: () => Date;
  pollIntervalMs?: number;
  maxAttempts?: number;
  backoffMs?: (failedAttempts: number) => number;
}

export interface Worker {
  /**
   * Puts jobs left `running` back to `pending`. Call once on startup, before `start()`: with a
   * single API process, a job still marked running was interrupted by a crash or restart.
   */
  recoverInterrupted(): number;
  /** Claims and runs the next due job, if any. Resolves `true` if a job ran. */
  runOnce(): Promise<boolean>;
  /** Runs due jobs one at a time, polling while the queue is empty. */
  start(): void;
  /** Stops claiming jobs and resolves once the job in progress, if any, has finished. */
  stop(): Promise<void>;
}

export function createWorker({
  services,
  logger,
  jobs,
  now = () => new Date(),
  pollIntervalMs = 1000,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  backoffMs = defaultBackoffMs,
}: WorkerOptions): Worker {
  const { db } = services;
  const definitions = new Map(jobs.map((definition) => [definition.type, definition]));

  function claimNext() {
    const at = now();
    return db.transaction(
      (tx) => {
        const next = tx
          .select({ id: job.id })
          .from(job)
          .where(and(eq(job.status, 'pending'), lte(job.runAfter, at)))
          .orderBy(asc(job.runAfter), asc(job.id))
          .limit(1)
          .get();
        if (!next) return undefined;
        return tx
          .update(job)
          .set({ status: 'running', attempts: sql`${job.attempts} + 1` })
          .where(eq(job.id, next.id))
          .returning()
          .get();
      },
      { behavior: 'immediate' },
    );
  }

  function finish(id: number, values: Partial<typeof job.$inferInsert>) {
    db.update(job).set(values).where(eq(job.id, id)).run();
  }

  async function runOnce(): Promise<boolean> {
    const claimed = claimNext();
    if (!claimed) return false;

    const { id, type, attempts } = claimed;
    const log = logger.child({ jobId: id, jobType: type, attempt: attempts });

    const definition = definitions.get(type);
    if (!definition) {
      log.error('unknown job type, dead-lettered');
      finish(id, { status: 'dead', lastError: `Unknown job type "${type}"` });
      return true;
    }
    const payload = definition.payload.safeParse(claimed.payload);
    if (!payload.success) {
      // Retrying can't fix a payload that no longer matches its schema.
      log.error({ err: payload.error }, 'invalid job payload, dead-lettered');
      finish(id, { status: 'dead', lastError: `Invalid payload: ${payload.error.message}` });
      return true;
    }

    const started = performance.now();
    try {
      await definition.handle(payload.data, {
        services,
        logger: log,
        jobId: id,
        attempt: attempts,
      });
    } catch (error) {
      const lastError = (error instanceof Error ? error.message : String(error)).slice(
        0,
        MAX_ERROR_LENGTH,
      );
      if (attempts >= maxAttempts) {
        log.error({ err: error }, 'job failed for the last time, dead-lettered');
        finish(id, { status: 'dead', lastError });
      } else {
        const runAfter = new Date(now().getTime() + backoffMs(attempts));
        log.warn({ err: error, retryAt: runAfter.toISOString() }, 'job failed, will retry');
        finish(id, { status: 'pending', runAfter, lastError });
      }
      return true;
    }
    log.debug({ durationMs: Math.round(performance.now() - started) }, 'job succeeded');
    finish(id, { status: 'succeeded', lastError: null });
    return true;
  }

  let stopping = false;
  let loop: Promise<void> | undefined;
  let wakeUp: (() => void) | undefined;

  /** Waits for the poll interval, or until stop() is called. Returns at once if it already was. */
  function idle() {
    if (stopping) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async function run() {
    while (!stopping) {
      let ranJob = false;
      try {
        ranJob = await runOnce();
      } catch (error) {
        // A database problem, not a job failure (those are handled in runOnce). Back off and retry.
        logger.error({ err: error }, 'job worker could not claim or update a job');
      }
      if (!ranJob) await idle();
    }
  }

  return {
    recoverInterrupted() {
      return db
        .update(job)
        .set({ status: 'pending' })
        .where(eq(job.status, 'running'))
        .returning({ id: job.id })
        .all().length;
    },
    runOnce,
    start() {
      if (loop) return;
      stopping = false;
      loop = run();
    },
    async stop() {
      stopping = true;
      wakeUp?.();
      await loop;
      loop = undefined;
    },
  };
}
