import { IMAGE_MAX_BYTES, type ImportRecipeResult, RECIPE_LIMITS, tagNameKey } from '@myli/shared';
import { inArray } from 'drizzle-orm';
import type { BlobStore } from '../blobs/store.ts';
import type { Db } from '../db/database.ts';
import { tag } from '../db/schema.ts';
import { saveUpload } from '../images/images.ts';
import { processImage } from '../images/process.ts';
import type { Logger } from '../logger.ts';
import { type FetchFailure, FetchRefused, type Outbound } from '../outbound/fetch.ts';
import { InvalidFields } from '../problems.ts';
import { readSchemaOrgRecipe, type SchemaOrgRecipe } from './schema-org.ts';

/** The most of a page an import reads: recipe pages are large, but rarely this large. */
export const PAGE_MAX_BYTES = 5 * 1024 * 1024;

/** What the address field says when a page can't be imported. */
export const IMPORT_DETAIL = {
  notPublic: 'myli only imports from sites on the public internet.',
  unreachable: "The page couldn't be fetched. Check the address, or try again later.",
  tooLarge: 'The page is too large to import.',
  timeout: 'The site took too long to answer. Try again later.',
  noRecipe: 'This page has no recipe data myli can read. Copy the recipe in by hand instead.',
} as const;

const PAGE_FAILURE_DETAIL: Record<FetchFailure, string> = {
  scheme: IMPORT_DETAIL.notPublic,
  address: IMPORT_DETAIL.notPublic,
  redirects: IMPORT_DETAIL.unreachable,
  status: IMPORT_DETAIL.unreachable,
  network: IMPORT_DETAIL.unreachable,
  'too-large': IMPORT_DETAIL.tooLarge,
  timeout: IMPORT_DETAIL.timeout,
};

interface ImportDeps {
  db: Db;
  blobs: BlobStore;
  outbound: Outbound;
  logger: Logger;
}

/**
 * Reads the recipe on another site's page, to fill in the New recipe form (spec §3.7). It saves
 * nothing but its photo, as `importerId`'s upload. A page that can't be imported is an
 * `InvalidFields` at `url`, saying why.
 */
export async function importRecipe(
  deps: ImportDeps,
  importerId: string,
  url: string,
): Promise<ImportRecipeResult> {
  let page;
  try {
    page = await deps.outbound(url, {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      maxBytes: PAGE_MAX_BYTES,
    });
  } catch (error) {
    if (!(error instanceof FetchRefused)) throw error;
    deps.logger.info({ reason: error.reason }, 'recipe page not fetched');
    throw new InvalidFields([{ path: ['url'], detail: PAGE_FAILURE_DETAIL[error.reason] }]);
  }
  const read = readSchemaOrgRecipe(decodeText(page.body, page.contentType), page.url);
  if (!read) {
    deps.logger.info('recipe page has no recipe data');
    throw new InvalidFields([{ path: ['url'], detail: IMPORT_DETAIL.noRecipe }]);
  }
  const tagIds = existingTags(deps.db, read.tags);
  const photo = read.imageUrl === null ? null : await importPhoto(deps, importerId, read.imageUrl);
  deps.logger.info({ tags: tagIds.length, photo: photo !== null }, 'recipe imported');
  return {
    recipe: {
      ...read.recipe,
      tagIds,
      images: photo ? [{ id: photo.id, alt: photo.alt }] : [],
      coverImageId: photo?.id ?? null,
    },
    images: photo ? [photo] : [],
  };
}

/** A page's text, in the character set its `Content-Type` names, UTF-8 if none or unknown. */
function decodeText(body: Buffer, contentType: string | null) {
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? '')?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/** Tag names compared without case, spaces or punctuation: "Gluten Free" is "gluten-free". */
const looseKey = (name: string) => tagNameKey(name).replace(/[^\p{L}\p{N}]+/gu, '');

/** The IDs of the tags a page names that exist already, of the same type. Never new ones. */
function existingTags(db: Db, named: SchemaOrgRecipe['tags']): number[] {
  if (named.length === 0) return [];
  const wanted = new Set(named.map(({ type, name }) => `${type}:${looseKey(name)}`));
  const types = [...new Set(named.map(({ type }) => type))];
  return db
    .select({ id: tag.id, type: tag.type, name: tag.name })
    .from(tag)
    .where(inArray(tag.type, types))
    .orderBy(tag.id)
    .all()
    .filter(({ type, name }) => wanted.has(`${type}:${looseKey(name)}`))
    .map(({ id }) => id)
    .slice(0, RECIPE_LIMITS.tags);
}

/**
 * The page's photo, fetched as the page was and uploaded as `importerId`'s, through the same
 * checks as any upload. `null` if it can't be: the import goes on without it.
 */
async function importPhoto(deps: ImportDeps, importerId: string, url: string) {
  try {
    const fetched = await deps.outbound(url, {
      accept: 'image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1',
      maxBytes: IMAGE_MAX_BYTES,
    });
    const processed = await processImage(new Uint8Array(fetched.body));
    if (!processed.ok) {
      deps.logger.info({ problem: processed.problem }, 'recipe photo not accepted');
      return null;
    }
    return await saveUpload(deps, importerId, processed.image);
  } catch (error) {
    if (!(error instanceof FetchRefused)) throw error;
    deps.logger.info({ reason: error.reason }, 'recipe photo not fetched');
    return null;
  }
}
