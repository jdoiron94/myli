import { type Db, migrateDatabase, openDatabase } from './database.ts';

/**
 * A fresh, fully migrated in-memory database. Each call is independent, so tests can't see each
 * other's rows. Close it with `db.$client.close()` if a test opens many.
 */
export function createTestDatabase(): Db {
  const db = openDatabase(':memory:');
  migrateDatabase(db);
  return db;
}
