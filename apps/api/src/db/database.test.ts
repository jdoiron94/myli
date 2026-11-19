import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, migrateDatabase, openDatabase } from './database.ts';
import { job } from './schema.ts';
import { createTestDatabase } from './testing.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A database file in a fresh temporary directory, removed after the test. */
function openTempDatabase(...segments: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'myli-db-'));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const path = join(dir, ...segments, 'myli.db');
  return { path, db: track(openDatabase(path)) };
}

function track(db: Db) {
  cleanups.push(() => db.$client.close());
  return db;
}

describe('openDatabase', () => {
  it('applies the connection settings from ADR 0002', () => {
    const { db } = openTempDatabase();
    const pragma = (name: string): unknown => db.$client.pragma(name, { simple: true });

    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('busy_timeout')).toBe(5000);
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('synchronous')).toBe(1); // NORMAL
  });

  it('creates missing parent directories', () => {
    const { path } = openTempDatabase('nested', 'dirs');
    expect(existsSync(path)).toBe(true);
  });
});

describe('migrateDatabase', () => {
  it('skips migrations that already ran, so a restart keeps the data', () => {
    const { path, db } = openTempDatabase();
    migrateDatabase(db);
    db.insert(job).values({ type: 'example', payload: {} }).run();

    const afterRestart = track(openDatabase(path));
    migrateDatabase(afterRestart);
    expect(afterRestart.select().from(job).all()).toHaveLength(1);
  });
});

describe('job table', () => {
  it('rejects unknown statuses at the database level', () => {
    const db = createTestDatabase();
    const insert = db.$client.prepare(
      "insert into job (type, payload, status, run_after, created_at) values ('x', '{}', 'bogus', 0, 0)",
    );
    expect(() => insert.run()).toThrow(/CHECK constraint failed: job_status_check/);
  });
});

describe('createTestDatabase', () => {
  it('gives every caller its own migrated database', () => {
    const first = createTestDatabase();
    const second = createTestDatabase();
    first.insert(job).values({ type: 'example', payload: {} }).run();

    expect(first.select().from(job).all()).toHaveLength(1);
    expect(second.select().from(job).all()).toEqual([]);
  });
});
