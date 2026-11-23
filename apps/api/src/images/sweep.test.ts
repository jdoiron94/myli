import { randomUUID } from 'node:crypto';
import { ne } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createMemoryBlobStore } from '../blobs/memory.ts';
import { image, user } from '../db/schema.ts';
import { createTestDatabase } from '../db/testing.ts';
import { saveDraft } from '../drafts/drafts.ts';
import { allJobs } from '../jobs/all.ts';
import { createWorker } from '../jobs/worker.ts';
import { createLogger } from '../logger.ts';
import { updateRecipe } from '../recipes/recipes.ts';
import { insertRecipe, sampleRecipeContent } from '../recipes/testing.ts';
import { DAY_MS } from '../trash/trash.ts';
import { queueImageSweep } from './sweep.ts';
import { insertRecipeImage } from './testing.ts';

it('deletes a recipe’s photos that nothing shows, keeping those its revisions or draft do', async () => {
  const db = createTestDatabase();
  const blobs = createMemoryBlobStore();
  db.insert(user).values({ id: 'owner', name: 'Owner', email: 'owner@example.com' }).run();
  const id = insertRecipe(db, 'owner');
  const photo = () => insertRecipeImage({ db, blobs }, id);
  const [cover, replaced, stepPhoto, drafted, recent] = [
    await photo(),
    await photo(),
    await photo(),
    await photo(),
    await photo(),
  ];
  // As a discarded draft leaves a photo behind: the recipe's, shown by nothing.
  await photo();
  const content = (images: string[], step: string | null) =>
    sampleRecipeContent({
      images: images.map((photoId) => ({ id: photoId, alt: '' })),
      coverImageId: images[0] ?? null,
      steps: [{ body: 'Bake.', image: step === null ? null : { id: step, alt: '' } }],
    });
  // Revision 2 shows two photos. Revision 3 drops one and gives a step one; the draft adds another.
  expect(updateRecipe(db, id, content([cover, replaced], null), 'owner', 1)).toMatchObject({
    ok: true,
  });
  expect(updateRecipe(db, id, content([cover], stepPhoto), 'owner', 2)).toMatchObject({ ok: true });
  expect(saveDraft(db, id, content([cover, drafted], stepPhoto), 'owner', 3)).toEqual({ ok: true });
  // An upload no recipe was saved with is for its own job (`discardUnsavedImageJob`).
  const unsaved = randomUUID();
  db.insert(image)
    .values({
      id: unsaved,
      uploaderId: 'owner',
      mime: 'image/png',
      width: 1,
      height: 1,
      variants: [],
    })
    .run();
  db.update(image)
    .set({ createdAt: new Date(Date.now() - 2 * DAY_MS) })
    .where(ne(image.id, recent))
    .run();
  const worker = createWorker({
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

  queueImageSweep(db);
  while (await worker.runOnce()) {
    // Until none is due, the blobs' job included.
  }

  // All but the one left behind, and its file.
  const kept = [cover, replaced, stepPhoto, drafted, recent];
  const left = db
    .select({ id: image.id })
    .from(image)
    .all()
    .map((row) => row.id);
  expect(left.sort()).toEqual([...kept, unsaved].sort());
  expect(blobs.keys()).toEqual(kept.map((photoId) => `images/${photoId}/64.webp`).sort());
});
