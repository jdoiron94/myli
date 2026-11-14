import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import { expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './database.ts';
import * as schema from './schema.ts';

type Snapshot = Parameters<typeof generateSQLiteMigration>[0];

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, ...segments), 'utf8'));
}

it('has a migration for every schema change (run `pnpm db:generate` to add one)', async () => {
  const journal = readJson('meta', '_journal.json') as { entries: { idx: number }[] };
  const latest = journal.entries.at(-1);
  if (!latest) throw new Error('no migrations in the journal');
  const snapshot = readJson('meta', `${String(latest.idx).padStart(4, '0')}_snapshot.json`);

  const pending = await generateSQLiteMigration(
    snapshot as Snapshot,
    await generateSQLiteDrizzleJson(schema),
  );
  expect(pending).toEqual([]);
});
