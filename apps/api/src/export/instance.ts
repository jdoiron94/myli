import type { PolicyUser, Recipe } from '@myli/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { BlobStore } from '../blobs/store.ts';
import type { Db, Tx } from '../db/database.ts';
import { image, recipe, recipeRevision, tag, user } from '../db/schema.ts';
import type { Logger } from '../logger.ts';
import { readableBy } from '../recipes/list.ts';
import { loadRecipe } from '../recipes/recipes.ts';
import { type RecipeSnapshot, readSnapshot } from '../revisions/snapshot.ts';

/**
 * The full export (spec §3.7): every recipe the exporting admin may see, as published, with its
 * revisions; every tag; and each photo they show, at its largest size. One-way: myli doesn't read
 * it back. Backups hold everything, other people's private recipes included.
 *
 * The archive:
 * - `recipes/<id>.json`: an `ArchivedRecipe`
 * - `photos/<id>.webp`
 * - `tags.json`: every tag, by type and name
 * - `manifest.json`, last: what's in it, and the photos whose files were missing
 */

/** A photo as content refers to it: which one, and its alt text there. */
interface ArchivedPhoto {
  id: string;
  alt: string;
}

/** What a revision, or the recipe as published, says. */
type ArchivedContent = Pick<
  Recipe,
  | 'title'
  | 'description'
  | 'source'
  | 'equipment'
  | 'yield'
  | 'servings'
  | 'prepMinutes'
  | 'cookMinutes'
  | 'totalMinutes'
  | 'difficulty'
  | 'nutrition'
  | 'ingredientGroups'
> & {
  tags: { type: string; name: string }[];
  photos: ArchivedPhoto[];
  coverPhotoId: string | null;
  steps: { body: string; photo: ArchivedPhoto | null }[];
};

export type ArchivedRecipe = ArchivedContent & {
  id: string;
  owner: { name: string };
  visibility: Recipe['visibility'];
  createdAt: string;
  updatedAt: string;
  /** Oldest first: the last is what's published. */
  revisions: (ArchivedContent & {
    number: number;
    createdAt: string;
    author: { name: string };
    message: string | null;
  })[];
};

/** What the archive holds, read in one go, so it's the instance as it was at one moment. */
export interface InstanceContents {
  recipes: ArchivedRecipe[];
  tags: { type: string; name: string }[];
  /** The photos they show, with the key of each one's largest size. */
  photos: { id: string; key: string }[];
}

export const EXPORT_FORMAT_VERSION = 1;

function archived(content: Recipe | RecipeSnapshot): ArchivedContent {
  const photo = ({ id, alt }: ArchivedPhoto) => ({ id, alt });
  return {
    title: content.title,
    description: content.description,
    source: content.source,
    equipment: content.equipment,
    yield: content.yield,
    servings: content.servings,
    prepMinutes: content.prepMinutes,
    cookMinutes: content.cookMinutes,
    totalMinutes: content.totalMinutes,
    difficulty: content.difficulty,
    nutrition: content.nutrition,
    ingredientGroups: content.ingredientGroups,
    tags: content.tags.map(({ type, name }) => ({ type, name })),
    photos: content.images.map(photo),
    coverPhotoId: content.coverImageId,
    steps: content.steps.map(({ body, image }) => ({ body, photo: image && photo(image) })),
  };
}

/** The IDs of the photos `content` shows. */
const photoIds = (content: ArchivedContent) => [
  ...content.photos.map(({ id }) => id),
  ...content.steps.flatMap(({ photo }) => (photo ? [photo.id] : [])),
];

/** What `exporter` may see, to export. Synchronous, so nothing changes while it's read. */
export function readInstance(db: Db | Tx, exporter: PolicyUser): InstanceContents {
  const ids = db
    .select({ id: recipe.id })
    .from(recipe)
    .where(readableBy(exporter))
    .orderBy(asc(recipe.createdAt), asc(recipe.id))
    .all()
    .map(({ id }) => id);
  const recipes = ids.flatMap((id): ArchivedRecipe[] => {
    const published = loadRecipe(db, id);
    if (!published) return [];
    const revisions = db
      .select({ row: recipeRevision, authorName: user.name })
      .from(recipeRevision)
      .innerJoin(user, eq(user.id, recipeRevision.authorId))
      .where(eq(recipeRevision.recipeId, id))
      .orderBy(asc(recipeRevision.number))
      .all()
      .map(({ row, authorName }) => ({
        number: row.number,
        createdAt: row.createdAt.toISOString(),
        author: { name: authorName },
        message: row.message,
        ...archived(readSnapshot(row.snapshot)),
      }));
    return [
      {
        id,
        owner: { name: published.owner.name },
        visibility: published.visibility,
        createdAt: published.createdAt,
        updatedAt: published.updatedAt,
        ...archived(published),
        revisions,
      },
    ];
  });

  // Each photo once, though several revisions show it, and only if it's one of its recipe's.
  const shown = new Map(
    recipes.flatMap((each) =>
      [each, ...each.revisions].flatMap(photoIds).map((photoId) => [photoId, each.id] as const),
    ),
  );
  const photos =
    shown.size === 0
      ? []
      : db
          .select({ id: image.id, recipeId: image.recipeId, variants: image.variants })
          .from(image)
          .where(inArray(image.id, [...shown.keys()]))
          .orderBy(asc(image.id))
          .all()
          .flatMap(({ id, recipeId, variants }) => {
            const largest = variants.at(-1);
            return recipeId === shown.get(id) && largest ? [{ id, key: largest.key }] : [];
          });

  const tags = db
    .select({ type: tag.type, name: tag.name })
    .from(tag)
    .orderBy(asc(tag.type), asc(tag.nameKey))
    .all();
  return { recipes, tags, photos };
}

const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

/**
 * The archive of `contents`, as a stream of chunks of a zip file, made as they're read: one photo
 * at a time is held in memory. JSON is compressed; photos, already WebP, are stored as they are.
 */
export async function* instanceArchive(
  contents: InstanceContents,
  { blobs, logger, now }: { blobs: BlobStore; logger: Logger; now: Date },
): AsyncGenerator<Uint8Array> {
  const chunks: Uint8Array[] = [];
  // Every entry here is compressed synchronously, so its chunks are all out once it's pushed.
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  const add = (name: string, data: Uint8Array, compress: boolean) => {
    const entry = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    entry.mtime = now;
    zip.add(entry);
    entry.push(data, true);
    return chunks.splice(0);
  };

  for (const archivedRecipe of contents.recipes) {
    yield* add(`recipes/${archivedRecipe.id}.json`, json(archivedRecipe), true);
  }
  yield* add('tags.json', json(contents.tags), true);

  const missingPhotos: string[] = [];
  for (const { id, key } of contents.photos) {
    const blob = await blobs.get(key);
    if (!blob) {
      // Its row says it's there: a store that lost files, or was restored without them.
      logger.error({ imageId: id, key }, 'image blob missing from the export');
      missingPhotos.push(id);
      continue;
    }
    yield* add(`photos/${id}.webp`, Buffer.concat(await blob.body.toArray()), false);
  }

  yield* add(
    'manifest.json',
    json({
      format: 'myli.export',
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: now.toISOString(),
      recipes: contents.recipes.length,
      tags: contents.tags.length,
      photos: contents.photos.length - missingPhotos.length,
      missingPhotos,
    }),
    true,
  );
  zip.end();
  yield* chunks.splice(0);
}
