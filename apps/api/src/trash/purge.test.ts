import { eq, getTableName, gt, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import {
  auditEvent,
  favorite,
  image,
  job,
  recipe,
  recipeDraft,
  recipeIngredient,
  recipeRevision,
  recipeStep,
  recipeTag,
  user,
} from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { insertRecipeImage } from '../images/testing.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker } from '../jobs/worker.ts';
import { createLogger } from '../logger.ts';
import { insertRecipe, sampleRecipeContent } from '../recipes/testing.ts';
import { queueTrashPurge } from './purge.ts';
import { DAY_MS } from './trash.ts';

const NOW = new Date('2026-11-16T03:30:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

function setUp() {
  const db = createTestDatabase();
  const blobs = createMemoryBlobStore();
  db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.com' }).run();
  const worker = createWorker({
    // Search is left out: its updates are retried later, and the purge doesn't wait for them.
    services: {
      db,
      mailer: null,
      publicUrl: 'https://myli.test',
      search: { client: undefined },
      blobs,
    },
    logger: createLogger('silent'),
    jobs: allJobs,
  });
  /** Runs every job that's due, the ones they queue included. */
  async function runJobs() {
    while (await worker.runOnce()) {
      // Until none is due.
    }
  }
  /** A recipe that went in the trash `days` before `NOW`. */
  function trashed(days: number | null, visibility: 'shared' | 'private' = 'shared') {
    const id = insertRecipe(db, 'owner', visibility);
    if (days !== null) {
      db.update(recipe)
        .set({ deletedAt: daysAgo(days) })
        .where(eq(recipe.id, id))
        .run();
    }
    return id;
  }
  return { db, blobs, runJobs, trashed };
}

describe('purgeTrashJob', () => {
  it('deletes what has been in the trash past its retention, with its history, draft and photos', async () => {
    const { db, blobs, runJobs, trashed } = setUp();
    const due = trashed(31);
    const duePrivate = trashed(45, 'private');
    const recent = trashed(29);
    const live = trashed(null);
    // The due recipe's cover, a step's photo, and one it no longer shows.
    const cover = await insertRecipeImage({ db, blobs }, due);
    const stepPhoto = await insertRecipeImage({ db, blobs }, due);
    await insertRecipeImage({ db, blobs }, due);
    db.update(recipe).set({ coverImageId: cover }).where(eq(recipe.id, due)).run();
    db.update(recipeStep).set({ imageId: stepPhoto }).where(eq(recipeStep.recipeId, due)).run();
    db.insert(recipeDraft)
      .values({ recipeId: due, content: sampleRecipeContent(), revision: 1, authorId: 'owner' })
      .run();
    db.insert(favorite).values({ userId: 'owner', recipeId: due }).run();
    const kept = [
      await insertRecipeImage({ db, blobs }, recent),
      await insertRecipeImage({ db, blobs }, live),
    ];
    const purge = queueTrashPurge(db, 30, NOW);

    await runJobs();

    expect(
      db
        .select({ id: recipe.id })
        .from(recipe)
        .all()
        .map(({ id }) => id)
        .sort(),
    ).toEqual([recent, live].sort());
    const purged = [due, duePrivate];
    const left = Object.fromEntries(
      [recipeRevision, recipeDraft, recipeIngredient, recipeStep, recipeTag, favorite, image].map(
        (table) => [
          getTableName(table),
          db.select().from(table).where(inArray(table.recipeId, purged)).all().length,
        ],
      ),
    );
    expect(left).toEqual({
      recipe_revision: 0,
      recipe_draft: 0,
      recipe_ingredient: 0,
      recipe_step: 0,
      recipe_tag: 0,
      favorite: 0,
      image: 0,
    });
    expect(
      db
        .select({ id: image.id })
        .from(image)
        .all()
        .map(({ id }) => id)
        .sort(),
    ).toEqual(kept.sort());
    expect(blobs.keys()).toEqual(kept.map((id) => `images/${id}/64.webp`).sort());

    const purges = db
      .select({
        actorId: auditEvent.actorId,
        targetId: auditEvent.targetId,
        metadata: auditEvent.metadata,
      })
      .from(auditEvent)
      .where(eq(auditEvent.action, 'recipe.purged'))
      .all();
    expect(purges).toEqual(
      expect.arrayContaining([
        {
          actorId: null,
          targetId: due,
          metadata: { title: 'Weeknight Bread', visibility: 'shared' },
        },
        { actorId: null, targetId: duePrivate, metadata: { visibility: 'private' } },
      ]),
    );
    expect(purges).toHaveLength(2);
    // Each tells search, which took it out when it was deleted, unless that failed for good.
    const queuedSince = db
      .select({ type: job.type, payload: job.payload })
      .from(job)
      .where(gt(job.id, purge))
      .all()
      .filter(({ type }) => type === 'search.index-recipe')
      .map(({ payload }) => payload);
    expect(queuedSince).toEqual(
      expect.arrayContaining([{ recipeId: due }, { recipeId: duePrivate }]),
    );
  });
});
