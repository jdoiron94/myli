import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { type Db, migrateDatabase, openDatabase } from './database.ts';
import * as schema from './schema.ts';
import { job } from './schema.ts';

/**
 * A fresh, fully migrated in-memory database. Each call is independent, so tests can't see each
 * other's rows. Close it with `db.$client.close()` if a test opens many.
 */
export function createTestDatabase(): Db {
  const db = openDatabase(':memory:');
  migrateDatabase(db);
  return db;
}

/**
 * Runs `run` as a script run beside the API does (`pnpm seed`, `pnpm reindex`): on a migrated
 * database file, through a connection of its own, `script`, while the API has another, `api`.
 *
 * Just before the script first runs a query starting with one of `before`, the API writes a job
 * row, as its worker does. If the script's transaction took the write lock as it began
 * (`{ behavior: 'immediate' }`), the API's write is refused, since it doesn't wait here, and the
 * script goes on. If not, the API's write commits, and the script's own write then fails with
 * SQLITE_BUSY_SNAPSHOT, which no busy timeout waits out. `apiWrites` says, for each of `before`
 * that the script reached, whether the API's write got in.
 */
export function besideTheApi<T>(
  before: string[],
  run: (script: Db, api: Db) => T,
): { result: T; apiWrites: Record<string, boolean> } {
  const dir = mkdtempSync(join(tmpdir(), 'myli-beside-'));
  const path = join(dir, 'myli.db');
  const api = openDatabase(path);
  const apiWrites: Record<string, boolean> = {};
  // Drizzle logs each query just before running it.
  const script = drizzle({
    client: openDatabase(path).$client,
    schema,
    logger: {
      logQuery(query) {
        const prefix = before.find((start) => query.startsWith(start));
        if (prefix === undefined || prefix in apiWrites) return;
        try {
          api.insert(job).values({ type: 'search.index-recipe', payload: {} }).run();
          apiWrites[prefix] = true;
        } catch {
          apiWrites[prefix] = false;
        }
      },
    },
  });
  try {
    migrateDatabase(api);
    // Fails at once rather than wait, since both connections are in this one thread.
    api.$client.pragma('busy_timeout = 0');
    return { result: run(script, api), apiWrites };
  } finally {
    api.$client.close();
    script.$client.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
