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

function tableNames(db: Db) {
  return db.$client
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .pluck()
    .all()
    .sort();
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
  it('creates the schema', () => {
    const { db } = openTempDatabase();
    migrateDatabase(db);
    expect(tableNames(db)).toEqual([
      '__drizzle_migrations',
      'account',
      'invitation',
      'job',
      'session',
      'setup_claim',
      'user',
      'verification',
    ]);
  });

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
  it('fills in defaults for new jobs', () => {
    const db = createTestDatabase();
    const [inserted] = db
      .insert(job)
      .values({ type: 'search.index', payload: { recipeId: 1 } })
      .returning()
      .all();

    expect(inserted).toMatchObject({
      type: 'search.index',
      payload: { recipeId: 1 },
      status: 'pending',
      attempts: 0,
      lastError: null,
    });
    expect(inserted?.runAfter).toBeInstanceOf(Date);
    expect(inserted?.createdAt).toBeInstanceOf(Date);
  });

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
