import {
  type CreateRecipeRequest,
  normalizeIngredientName,
  type PolicyRecipe,
  type Recipe,
  type UpdateRecipeRequest,
  type Visibility,
} from '@myli/shared';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { type AuditOrigin, recordAuditEvent } from '../audit/audit.ts';
import type { Db, Tx } from '../db/database.ts';
import { image, recipe, recipeIngredient, recipeStep, recipeTag, tag, user } from '../db/schema.ts';
import { deleteBlobsJob, toImage } from '../images/images.ts';
import { enqueueJob } from '../jobs/queue.ts';
import { indexRecipeJob } from '../search/indexing.ts';
import { byTypeThenName } from '../tags/tags.ts';

/**
 * Recipes (spec §3.2). Until Phase 2 adds drafts, saving writes the one live version directly, and
 * the last save wins. A deleted recipe is hidden everywhere, exactly as if it didn't exist.
 *
 * Every write that changes a recipe's search document queues `indexRecipeJob` in its transaction,
 * so the index follows whether or not Meilisearch is up (spec §4).
 */

/** Everything about a recipe that editing it sets. */
export type RecipeContent = UpdateRecipeRequest;

/** Optional text is stored as `null` when it's empty. */
const orNull = (text: string | null) => (text === null || text === '' ? null : text);

function contentColumns(content: RecipeContent) {
  const { source, nutrition } = content;
  return {
    title: content.title,
    descriptionMd: content.description,
    sourceUrl: source.url,
    sourceTitle: orNull(source.title),
    sourceAuthor: orNull(source.author),
    equipment: content.equipment,
    yieldQty: content.yield?.qty ?? null,
    yieldUnit: orNull(content.yield?.unit ?? null),
    servings: content.servings,
    prepMin: content.prepMinutes,
    cookMin: content.cookMinutes,
    totalMin: content.totalMinutes,
    difficulty: content.difficulty,
    coverImageId: content.coverImageId,
    nutritionCalories: nutrition.calories,
    nutritionProteinG: nutrition.proteinGrams,
    nutritionCarbsG: nutrition.carbsGrams,
    nutritionFatG: nutrition.fatGrams,
    nutritionFiberG: nutrition.fiberGrams,
    nutritionSugarG: nutrition.sugarGrams,
    nutritionSodiumMg: nutrition.sodiumMilligrams,
  };
}

/** Writes a recipe's lines, steps and tags, which saving replaces as a whole. */
function writeParts(tx: Tx, recipeId: string, content: RecipeContent): void {
  const lines = content.ingredientGroups.flatMap((group, groupPosition) =>
    group.ingredients.map((line, position) => ({
      recipeId,
      groupPosition,
      groupLabel: orNull(group.label),
      position,
      rawText: line.rawText,
      qty: line.qty,
      qtyMax: line.qtyMax,
      unit: line.unit,
      name: line.name,
      normalizedName: normalizeIngredientName(line.name),
      note: orNull(line.note),
      scalable: line.scalable,
    })),
  );
  if (lines.length > 0) tx.insert(recipeIngredient).values(lines).run();

  const steps = content.steps.map((step, position) => ({
    recipeId,
    position,
    bodyMd: step.body,
    imageId: step.image?.id ?? null,
  }));
  if (steps.length > 0) tx.insert(recipeStep).values(steps).run();

  const tags = content.tagIds.map((tagId) => ({ recipeId, tagId }));
  if (tags.length > 0) tx.insert(recipeTag).values(tags).run();
}

/** Where in `tagIds` the tags that don't exist are, for the 422 that names them. */
function missingTagIndexes(tx: Tx, tagIds: readonly number[]): number[] {
  if (tagIds.length === 0) return [];
  const found = new Set(
    tx
      .select({ id: tag.id })
      .from(tag)
      .where(inArray(tag.id, [...tagIds]))
      .all()
      .map(({ id }) => id),
  );
  return tagIds.flatMap((id, index) => (found.has(id) ? [] : [index]));
}

/**
 * Each photo the content names, with its alt text, where it names it, and its place among the
 * recipe's photos (`null` for a step's).
 */
function photoUses(content: RecipeContent) {
  return [
    ...content.images.map(({ id, alt }, index) => ({
      id,
      alt,
      path: ['images', index, 'id'] as PropertyKey[],
      position: index,
    })),
    ...content.steps.flatMap(({ image }, index) =>
      image === null
        ? []
        : [
            {
              id: image.id,
              alt: image.alt,
              path: ['steps', index, 'image', 'id'] as PropertyKey[],
              position: null,
            },
          ],
    ),
  ];
}

type PhotoUse = ReturnType<typeof photoUses>[number];

/**
 * Where the content names photos it can't use: ones that don't exist, belong to another recipe, or
 * are someone else's uploads no recipe was saved with. `recipeId` is `null` for a new recipe.
 */
function unusablePhotos(
  tx: Tx,
  recipeId: string | null,
  editorId: string,
  uses: readonly PhotoUse[],
): PropertyKey[][] {
  if (uses.length === 0) return [];
  const rows = new Map(
    tx
      .select({ id: image.id, recipeId: image.recipeId, uploaderId: image.uploaderId })
      .from(image)
      .where(
        inArray(
          image.id,
          uses.map(({ id }) => id),
        ),
      )
      .all()
      .map((row) => [row.id, row]),
  );
  return uses
    .filter(({ id }) => {
      const row = rows.get(id);
      if (!row) return true;
      return row.recipeId === null ? row.uploaderId !== editorId : row.recipeId !== recipeId;
    })
    .map(({ path }) => path);
}

/**
 * Gives the recipe the photos it names, each in its place, and deletes those it named before and
 * no longer does, their blobs in a job. Until Phase 2 keeps revisions, nothing else refers to them.
 * Runs after the recipe's cover and steps are written, so none of them still refers to one.
 */
function writePhotos(tx: Tx, recipeId: string, uses: readonly PhotoUse[]): void {
  for (const { id, alt, position } of uses) {
    tx.update(image).set({ recipeId, position, altText: alt }).where(eq(image.id, id)).run();
  }
  const kept = uses.map(({ id }) => id);
  const dropped = tx
    .delete(image)
    .where(and(eq(image.recipeId, recipeId), notInArray(image.id, kept)))
    .returning({ variants: image.variants })
    .all();
  const keys = dropped.flatMap(({ variants }) => variants.map(({ key }) => key));
  if (keys.length > 0) enqueueJob(tx, deleteBlobsJob, { keys });
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'missing-tags'; missingTags: number[] }
  | { ok: false; reason: 'unusable-images'; paths: PropertyKey[][] }
  | { ok: false; reason: 'not-found' };

/** A live (not deleted) recipe's row. */
const live = (id: string) => and(eq(recipe.id, id), isNull(recipe.deletedAt));

/**
 * Creates a recipe owned by `ownerId`, unless one of its tags doesn't exist or it names a photo
 * that isn't one of their uploads no recipe was saved with.
 */
export function createRecipe(db: Db, ownerId: string, request: CreateRecipeRequest): SaveResult {
  return db.transaction((tx): SaveResult => {
    const missingTags = missingTagIndexes(tx, request.tagIds);
    if (missingTags.length > 0) return { ok: false, reason: 'missing-tags', missingTags };
    const photos = photoUses(request);
    const unusable = unusablePhotos(tx, null, ownerId, photos);
    if (unusable.length > 0) return { ok: false, reason: 'unusable-images', paths: unusable };

    const { id } = tx
      .insert(recipe)
      .values({ ownerId, visibility: request.visibility, ...contentColumns(request) })
      .returning({ id: recipe.id })
      .get();
    writeParts(tx, id, request);
    writePhotos(tx, id, photos);
    enqueueJob(tx, indexRecipeJob, { recipeId: id });
    return { ok: true, id };
  });
}

/**
 * Saves a recipe's content over what it had, lines, steps, tags and photos included, as edited by
 * `editorId`, whose uploads it can add. Its owner and visibility stay. The last save wins until
 * Phase 2's concurrency check.
 */
export function updateRecipe(
  db: Db,
  id: string,
  content: RecipeContent,
  editorId: string,
): SaveResult {
  return db.transaction((tx): SaveResult => {
    const missingTags = missingTagIndexes(tx, content.tagIds);
    if (missingTags.length > 0) return { ok: false, reason: 'missing-tags', missingTags };
    const photos = photoUses(content);
    const unusable = unusablePhotos(tx, id, editorId, photos);
    if (unusable.length > 0) return { ok: false, reason: 'unusable-images', paths: unusable };

    const [updated] = tx
      .update(recipe)
      .set(contentColumns(content))
      .where(live(id))
      .returning({ id: recipe.id })
      .all();
    if (!updated) return { ok: false, reason: 'not-found' };

    tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, id)).run();
    tx.delete(recipeStep).where(eq(recipeStep.recipeId, id)).run();
    tx.delete(recipeTag).where(eq(recipeTag.recipeId, id)).run();
    writeParts(tx, id, content);
    writePhotos(tx, id, photos);
    enqueueJob(tx, indexRecipeJob, { recipeId: id });
    return { ok: true, id };
  });
}

/** Makes a recipe private or shared. False if it doesn't exist or was deleted. */
export function setRecipeVisibility(db: Db, id: string, visibility: Visibility): boolean {
  return db.transaction((tx) => {
    const [updated] = tx
      .update(recipe)
      .set({ visibility })
      .where(live(id))
      .returning({ id: recipe.id })
      .all();
    if (!updated) return false;
    enqueueJob(tx, indexRecipeJob, { recipeId: id });
    return true;
  });
}

/**
 * Deletes a recipe: it's hidden everywhere from now on, but its rows stay for the trash in Phase 2.
 * The audit event shows admins a shared recipe's title, but never a private one's: admins may not
 * see private recipes, so their titles stay out of the log. False if the recipe is already gone.
 */
export function deleteRecipe(db: Db, origin: AuditOrigin, id: string): boolean {
  return db.transaction((tx) => {
    const [deleted] = tx
      .update(recipe)
      .set({ deletedAt: new Date() })
      .where(live(id))
      .returning({ title: recipe.title, visibility: recipe.visibility })
      .all();
    if (!deleted) return false;
    enqueueJob(tx, indexRecipeJob, { recipeId: id });
    recordAuditEvent(tx, origin, {
      action: 'recipe.deleted',
      target: { type: 'recipe', id },
      metadata:
        deleted.visibility === 'shared'
          ? { title: deleted.title, visibility: 'shared' }
          : { visibility: 'private' },
    });
    return true;
  });
}

/** What authorizing an action on a recipe needs. `undefined` if it doesn't exist or was deleted. */
export function findRecipeAccess(db: Db | Tx, id: string): PolicyRecipe | undefined {
  return db
    .select({ ownerId: recipe.ownerId, visibility: recipe.visibility })
    .from(recipe)
    .where(live(id))
    .get();
}

/** The whole recipe as the API shows it. `undefined` if it doesn't exist or was deleted. */
export function loadRecipe(db: Db | Tx, id: string): Recipe | undefined {
  const found = db
    .select({ row: recipe, ownerName: user.name })
    .from(recipe)
    .innerJoin(user, eq(user.id, recipe.ownerId))
    .where(live(id))
    .get();
  if (!found) return undefined;
  const { row, ownerName } = found;

  const lines = db
    .select()
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeId, id))
    .orderBy(asc(recipeIngredient.groupPosition), asc(recipeIngredient.position))
    .all();
  const groups: Recipe['ingredientGroups'] = [];
  let groupPosition: number | undefined;
  for (const line of lines) {
    if (line.groupPosition !== groupPosition) {
      groups.push({ label: line.groupLabel, ingredients: [] });
      groupPosition = line.groupPosition;
    }
    groups.at(-1)?.ingredients.push({
      rawText: line.rawText,
      qty: line.qty,
      qtyMax: line.qtyMax,
      unit: line.unit,
      name: line.name,
      normalizedName: line.normalizedName,
      note: line.note,
      scalable: line.scalable,
    });
  }

  const photos = db.select().from(image).where(eq(image.recipeId, id)).all();
  const photoById = new Map(photos.map((photo) => [photo.id, toImage(photo)]));
  const images = photos
    .flatMap((photo) => (photo.position === null ? [] : [{ ...photo, position: photo.position }]))
    .sort((a, b) => a.position - b.position)
    .map(toImage);

  const steps = db
    .select({ body: recipeStep.bodyMd, imageId: recipeStep.imageId })
    .from(recipeStep)
    .where(eq(recipeStep.recipeId, id))
    .orderBy(asc(recipeStep.position))
    .all()
    .map(({ body, imageId }) => ({
      body,
      image: (imageId === null ? undefined : photoById.get(imageId)) ?? null,
    }));

  const tags = db
    .select({ id: tag.id, type: tag.type, name: tag.name, nameKey: tag.nameKey })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(eq(recipeTag.recipeId, id))
    .all()
    .sort(byTypeThenName)
    .map(({ id: tagId, type, name }) => ({ id: tagId, type, name }));

  return {
    id: row.id,
    owner: { id: row.ownerId, name: ownerName },
    visibility: row.visibility,
    title: row.title,
    description: row.descriptionMd,
    source: { url: row.sourceUrl, title: row.sourceTitle, author: row.sourceAuthor },
    equipment: row.equipment,
    yield: row.yieldQty === null ? null : { qty: row.yieldQty, unit: row.yieldUnit },
    servings: row.servings,
    prepMinutes: row.prepMin,
    cookMinutes: row.cookMin,
    totalMinutes: row.totalMin,
    difficulty: row.difficulty,
    nutrition: {
      calories: row.nutritionCalories,
      proteinGrams: row.nutritionProteinG,
      carbsGrams: row.nutritionCarbsG,
      fatGrams: row.nutritionFatG,
      fiberGrams: row.nutritionFiberG,
      sugarGrams: row.nutritionSugarG,
      sodiumMilligrams: row.nutritionSodiumMg,
    },
    ingredientGroups: groups,
    steps,
    tags,
    images,
    coverImageId: row.coverImageId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
