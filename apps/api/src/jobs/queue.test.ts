import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { job } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { defineJob } from './define.ts';
import { enqueueJob } from './queue.ts';

const greetJob = defineJob({
  type: 'test.greet',
  payload: z.object({ name: z.string(), greeting: z.string().default('Hello') }),
  handle: () => Promise.resolve(),
});

describe('enqueueJob', () => {
  it('commits the job together with the write it belongs to', () => {
    const db = createTestDatabase();
    db.transaction((tx) => {
      enqueueJob(tx, greetJob, { name: 'Ada' });
    });

    expect(db.select().from(job).all()).toMatchObject([
      { type: 'test.greet', status: 'pending', payload: { name: 'Ada', greeting: 'Hello' } },
    ]);
  });

  it('leaves no job behind when the transaction rolls back', () => {
    const db = createTestDatabase();
    expect(() => {
      db.transaction((tx) => {
        enqueueJob(tx, greetJob, { name: 'Ada' });
        throw new Error('the write failed');
      });
    }).toThrow('the write failed');

    expect(db.select().from(job).all()).toEqual([]);
  });

  it('rejects a payload that does not match the schema, and queues nothing', () => {
    const db = createTestDatabase();
    expect(() => {
      // @ts-expect-error -- deliberately invalid: the payload type is checked at compile time too
      enqueueJob(db, greetJob, { name: 42 });
    }).toThrow(z.ZodError);

    expect(db.select().from(job).all()).toEqual([]);
  });

  it('schedules the job for later when runAfter is given', () => {
    const db = createTestDatabase();
    const runAfter = new Date('2100-01-01T00:00:00Z');
    const id = enqueueJob(db, greetJob, { name: 'Ada' }, { runAfter });

    expect(db.select().from(job).get()).toMatchObject({ id, runAfter });
  });
});
