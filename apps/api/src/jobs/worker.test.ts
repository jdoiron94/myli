import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { job } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { createLogger } from '../logger.ts';
import { createMemoryMailer } from '../mail/testing.ts';
import { defineJob } from './define.ts';
import { enqueueJob } from './queue.ts';
import {
  createWorker,
  DEFAULT_MAX_ATTEMPTS,
  defaultBackoffMs,
  type WorkerOptions,
} from './worker.ts';

// Far in the future, so jobs queued at the real current time are always due.
const START = new Date('2100-01-01T00:00:00.000Z');

function setup(options: Partial<WorkerOptions> = {}) {
  const db = createTestDatabase();

  const logs: Record<string, unknown>[] = [];
  const logger = createLogger('debug', {
    write(line: string) {
      logs.push(JSON.parse(line) as Record<string, unknown>);
    },
  });

  let current = START;
  const clock = {
    now: () => current,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };

  const handled: { n: number; label: string; attempt: number }[] = [];
  const recordJob = defineJob({
    type: 'test.record',
    payload: z.object({ n: z.number(), label: z.string().default('none') }),
    handle(payload, context) {
      handled.push({ ...payload, attempt: context.attempt });
      return Promise.resolve();
    },
  });
  const failJob = defineJob({
    type: 'test.fail',
    payload: z.object({}),
    handle() {
      return Promise.reject(new Error('SMTP server unreachable'));
    },
  });

  const worker = createWorker({
    services: { db, mailer: null, publicUrl: 'https://myli.test', search: { client: undefined } },
    logger,
    jobs: [recordJob, failJob],
    now: clock.now,
    ...options,
  });
  const rows = () => db.select().from(job).orderBy(asc(job.id)).all();

  return { db, logs, clock, handled, recordJob, failJob, worker, rows };
}

describe('runOnce', () => {
  it('runs due jobs oldest first, with the parsed payload, and marks them succeeded', async () => {
    const { db, worker, handled, recordJob, rows } = setup();
    enqueueJob(db, recordJob, { n: 1 });
    enqueueJob(db, recordJob, { n: 2, label: 'earlier' }, { runAfter: new Date(0) });

    expect(await worker.runOnce()).toBe(true);
    expect(await worker.runOnce()).toBe(true);
    expect(await worker.runOnce()).toBe(false);

    expect(handled).toEqual([
      { n: 2, label: 'earlier', attempt: 1 },
      { n: 1, label: 'none', attempt: 1 },
    ]);
    expect(rows()).toMatchObject([
      { status: 'succeeded', attempts: 1, lastError: null },
      { status: 'succeeded', attempts: 1, lastError: null },
    ]);
  });

  it('leaves a job alone until its run_after time has passed', async () => {
    const { db, worker, clock, recordJob } = setup();
    enqueueJob(db, recordJob, { n: 1 }, { runAfter: new Date(START.getTime() + 60_000) });

    expect(await worker.runOnce()).toBe(false);
    clock.advance(60_000);
    expect(await worker.runOnce()).toBe(true);
  });

  it('retries a failed job with exponential backoff, keeping the error', async () => {
    const { db, worker, clock, failJob, rows, logs } = setup();
    const id = enqueueJob(db, failJob, {});

    await worker.runOnce();
    expect(rows()).toMatchObject([
      {
        status: 'pending',
        attempts: 1,
        runAfter: new Date(START.getTime() + 2000),
        lastError: 'SMTP server unreachable',
      },
    ]);
    expect(logs.find((line) => line.msg === 'job failed, will retry')).toMatchObject({
      level: 40,
      jobId: id,
      jobType: 'test.fail',
      attempt: 1,
    });

    expect(await worker.runOnce()).toBe(false); // not due yet
    clock.advance(2000);
    await worker.runOnce();
    expect(rows()).toMatchObject([
      { status: 'pending', attempts: 2, runAfter: new Date(START.getTime() + 2000 + 4000) },
    ]);
  });

  it(`dead-letters a job after ${DEFAULT_MAX_ATTEMPTS} failed attempts`, async () => {
    const { db, worker, clock, failJob, rows, logs } = setup();
    enqueueJob(db, failJob, {});

    for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt++) {
      expect(await worker.runOnce()).toBe(true);
      clock.advance(defaultBackoffMs(attempt));
    }

    expect(rows()).toMatchObject([
      { status: 'dead', attempts: DEFAULT_MAX_ATTEMPTS, lastError: 'SMTP server unreachable' },
    ]);
    expect(logs.filter((line) => line.level === 50)).toMatchObject([
      { msg: 'job failed for the last time, dead-lettered', attempt: DEFAULT_MAX_ATTEMPTS },
    ]);
    clock.advance(24 * 60 * 60 * 1000);
    expect(await worker.runOnce()).toBe(false);
  });

  it('tries a job as many times as its type says, if it says', async () => {
    const patient = defineJob({
      type: 'test.patient',
      payload: z.object({}),
      maxAttempts: DEFAULT_MAX_ATTEMPTS + 3,
      handle: () => Promise.reject(new Error('Search is unavailable')),
    });
    const { db, worker, clock, rows } = setup({ jobs: [patient] });
    enqueueJob(db, patient, {});

    for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS + 2; attempt++) {
      await worker.runOnce();
      clock.advance(defaultBackoffMs(attempt));
    }
    expect(rows()).toMatchObject([{ status: 'pending', attempts: DEFAULT_MAX_ATTEMPTS + 2 }]);

    await worker.runOnce();
    expect(rows()).toMatchObject([{ status: 'dead', attempts: DEFAULT_MAX_ATTEMPTS + 3 }]);
  });

  it('dead-letters a job of an unknown type right away', async () => {
    const { db, worker, rows } = setup();
    db.insert(job).values({ type: 'test.removed', payload: {} }).run();

    await worker.runOnce();
    expect(rows()).toMatchObject([
      { status: 'dead', attempts: 1, lastError: 'Unknown job type "test.removed"' },
    ]);
  });

  it('dead-letters a payload that no longer matches its schema, without running it', async () => {
    const { db, worker, handled, rows } = setup();
    db.insert(job)
      .values({ type: 'test.record', payload: { n: 'not a number' } })
      .run();

    await worker.runOnce();
    expect(handled).toEqual([]);
    expect(rows()).toMatchObject([
      { status: 'dead', lastError: expect.stringContaining('Invalid payload') as unknown },
    ]);
  });
});

describe('recoverInterrupted', () => {
  it('puts jobs left running back to pending, and nothing else', () => {
    const { db, worker, rows } = setup();
    db.insert(job)
      .values([
        { type: 'test.record', payload: { n: 1 }, status: 'running' },
        { type: 'test.record', payload: { n: 2 }, status: 'succeeded' },
        { type: 'test.record', payload: { n: 3 }, status: 'dead' },
      ])
      .run();

    expect(worker.recoverInterrupted()).toBe(1);
    expect(rows().map((row) => row.status)).toEqual(['pending', 'succeeded', 'dead']);
  });
});

describe('start and stop', () => {
  it('runs jobs queued while idle, and stop() waits for the job in progress', async () => {
    let started!: () => void;
    const jobStarted = new Promise<void>((resolve) => (started = resolve));
    let release!: () => void;
    const jobReleased = new Promise<void>((resolve) => (release = resolve));
    const slowJob = defineJob({
      type: 'test.slow',
      payload: z.object({}),
      async handle() {
        started();
        await jobReleased;
      },
    });

    const db = createTestDatabase();
    const worker = createWorker({
      services: { db, mailer: null, publicUrl: 'https://myli.test', search: { client: undefined } },
      logger: createLogger('silent'),
      jobs: [slowJob],
      pollIntervalMs: 5,
    });
    worker.start();
    const slowId = enqueueJob(db, slowJob, {});
    await jobStarted;

    let stopped = false;
    const stopping = worker.stop().then(() => (stopped = true));
    const queuedDuringStop = enqueueJob(db, slowJob, {});
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);

    release();
    await stopping;
    const statusOf = (id: number) =>
      db
        .select()
        .from(job)
        .all()
        .find((row) => row.id === id)?.status;
    expect(statusOf(slowId)).toBe('succeeded');
    expect(statusOf(queuedDuringStop)).toBe('pending');
  });

  it('stops promptly while idle, without waiting out the poll interval', async () => {
    const worker = createWorker({
      services: {
        db: createTestDatabase(),
        mailer: null,
        publicUrl: 'https://myli.test',
        search: { client: undefined },
      },
      logger: createLogger('silent'),
      jobs: [],
      pollIntervalMs: 60_000,
    });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 10)); // let it reach the idle wait

    const startedAt = performance.now();
    await worker.stop();
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });
});

describe('services', () => {
  it('reach every handler, so a job can send email, and a failed send is retried', async () => {
    const db = createTestDatabase();
    const { mailer, sent, failNext } = createMemoryMailer();
    const welcomeJob = defineJob({
      type: 'test.welcome-email',
      payload: z.object({ to: z.string() }),
      async handle({ to }, { services }) {
        if (!services.mailer) throw new Error('email is off');
        await services.mailer.send({ to, subject: 'Welcome', text: 'Hello!' });
      },
    });
    let now = START;
    const worker = createWorker({
      services: { db, mailer, publicUrl: 'https://myli.test', search: { client: undefined } },
      logger: createLogger('silent'),
      jobs: [welcomeJob],
      now: () => now,
    });
    const id = enqueueJob(db, welcomeJob, { to: 'ada@example.com' });

    failNext();
    await worker.runOnce();
    expect(sent).toEqual([]);
    expect(db.select().from(job).all()).toMatchObject([
      { id, status: 'pending', lastError: 'SMTP server unavailable' },
    ]);

    now = new Date(START.getTime() + defaultBackoffMs(1));
    await worker.runOnce();
    expect(sent).toEqual([{ to: 'ada@example.com', subject: 'Welcome', text: 'Hello!' }]);
    expect(db.select().from(job).all()).toMatchObject([{ id, status: 'succeeded' }]);
  });
});
