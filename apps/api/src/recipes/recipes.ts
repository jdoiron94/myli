import {
  type CreateRecipeRequest,
  normalizeIngredientName,
  type PolicyRecipe,
  type Recipe,
  type RecipeContent,
  type Visibility,
} from '@myli/shared';
import { and, asc, eq, inArray, isNotNull, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { type AuditOrigin, recordAuditEvent } from '../audit/audit.ts';
import type { Db, Tx } from '../db/database.ts';
import {
  image,
  recipe,
  recipeDraft,
  recipeIngredient,
  recipeStep,
  recipeTag,
  tag,
  user,
} from '../db/schema.ts';
import { toImage } from '../images/images.ts';
import { enqueueJob } from '../jobs/queue.ts';
import { latestRevision, recordRevision } from '../revisions/snapshot.ts';
import { indexRecipeJob } from '../search/indexing.ts';
import { byTypeThenName } from '../tags/tags.ts';

/**
 * Recipes (spec §3.2). The live tables hold the published version; publishing writes them and
 * records a revision, and a write based on an older version is refused (ADR 0007). Drafts are in
 * `drafts/drafts.ts`. A deleted recipe is in the trash, hidden everywhere, exactly as if it didn't
 * exist, but to whoever may restore it (`trash/trash.ts`).
 *
 * Every write that changes a recipe's search document queues `indexRecipeJob` in its transaction,
 * so the index follows whether or not Meilisearch is up (spec §4).
 */

/** Everything about a recipe that editing it sets. */

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
export function photoUses(content: RecipeContent) {
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

/** Gives the recipe the photos it names, each in its place, with the alt text it gives them. */
function writePhotos(tx: Tx, recipeId: string, uses: readonly PhotoUse[]): void {
  for (const { id, alt, position } of uses) {
    tx.update(image).set({ recipeId, position, altText: alt }).where(eq(image.id, id)).run();
  }
  // Older revisions show the photos it no longer uses, so they stay its own, in no place, until
  // the recipe is purged. A later save can use them again.
  const named = uses.map(({ id }) => id);
  tx.update(image)
    .set({ position: null })
    .where(and(eq(image.recipeId, recipeId), notInArray(image.id, named)))
    .run();
}

/** Why content can't be saved: tags in `tagIds` that don't exist, or photos it can't use. */
export type ContentRefusal =
  | { ok: false; reason: 'missing-tags'; missingTags: number[] }
  | { ok: false; reason: 'unusable-images'; paths: PropertyKey[][] };

/** A new recipe's ID, or why it couldn't be created. */
export type CreateResult = { ok: true; id: string } | ContentRefusal;

/** The saved recipe's ID, or why it couldn't be saved. */
export type SaveResult = CreateResult | WriteFailure;

/** Why a write to a recipe didn't happen: it's gone, or it changed since the version it names. */
type WriteFailure = { ok: false; reason: 'not-found' } | { ok: false; reason: 'stale' };

export type WriteResult = { ok: true } | WriteFailure;

/** A live (not deleted) recipe's row. */
const live = (id: string) => and(eq(recipe.id, id), isNull(recipe.deletedAt));

/** Records the recipe as a save in this transaction has just left it, as its next revision. */
function recordPublished(tx: Tx, id: string, authorId: string, message: string | null = null) {
  const published = loadRecipe(tx, id);
  // Written in this transaction: only a bug could lose it.
  if (!published) throw new Error('a recipe just saved could not be read back');
  recordRevision(tx, published, authorId, message);
}

/**
 * Why `editorId` can't save `content` to the recipe (`null` for a new one), if they can't: a tag
 * that no longer exists, or a photo that's neither the recipe's nor their own unsaved upload.
 */
export function refusedContent(
  tx: Tx,
  recipeId: string | null,
  editorId: string,
  content: RecipeContent,
): ContentRefusal | undefined {
  const missingTags = missingTagIndexes(tx, content.tagIds);
  if (missingTags.length > 0) return { ok: false, reason: 'missing-tags', missingTags };
  const unusable = unusablePhotos(tx, recipeId, editorId, photoUses(content));
  if (unusable.length > 0) return { ok: false, reason: 'unusable-images', paths: unusable };
  return undefined;
}

/**
 * Whether the live recipe is still at `version`, the one the write was based on (ADR 0007). Checked
 * first, so a write based on an old version is refused as that, whatever else is wrong with it.
 */
export function atVersion(tx: Tx, id: string, version: number): WriteResult {
  const row = tx.select({ version: recipe.version }).from(recipe).where(live(id)).get();
  if (!row) return { ok: false, reason: 'not-found' };
  return row.version === version ? { ok: true } : { ok: false, reason: 'stale' };
}

/** The live recipe's row at `version`, which a write moves on to the next one. */
export const liveAt = (id: string, version: number) => and(live(id), eq(recipe.version, version));

/**
 * Creates a recipe owned by `ownerId`, unless one of its tags doesn't exist or it names a photo
 * that isn't one of their uploads no recipe was saved with.
 */
export function createRecipe(db: Db, ownerId: string, request: CreateRecipeRequest): CreateResult {
  return db.transaction(
    (tx): CreateResult => {
      const refused = refusedContent(tx, null, ownerId, request);
      if (refused) return refused;

      const { id } = tx
        .insert(recipe)
        .values({ ownerId, visibility: request.visibility, ...contentColumns(request) })
        .returning({ id: recipe.id })
        .get();
      writeParts(tx, id, request);
      writePhotos(tx, id, photoUses(request));
      recordPublished(tx, id, ownerId);
      enqueueJob(tx, indexRecipeJob, { recipeId: id });
      return { ok: true, id };
    },
    // Reads, then writes, and the seed runs it beside the API.
    { behavior: 'immediate' },
  );
}

/**
 * Publishes a recipe's content over what it had, lines, steps, tags and photos included, as edited
 * by `editorId`, whose uploads it can add, and records it as the next revision, with `message`.
 * Its owner and visibility stay, and its draft goes, since what was published replaces it, unless
 * `keepDraft`. Refused if the recipe is no longer at `version`, the one the edit started from.
 */
export function publishContent(
  tx: Tx,
  id: string,
  content: RecipeContent,
  editorId: string,
  version: number,
  { message = null, keepDraft = false }: { message?: string | null; keepDraft?: boolean } = {},
): SaveResult {
  const current = atVersion(tx, id, version);
  if (!current.ok) return current;
  const refused = refusedContent(tx, id, editorId, content);
  if (refused) return refused;

  const [updated] = tx
    .update(recipe)
    .set({ ...contentColumns(content), version: version + 1 })
    .where(liveAt(id, version))
    .returning({ id: recipe.id })
    .all();
  if (!updated) return { ok: false, reason: 'stale' };

  tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, id)).run();
  tx.delete(recipeStep).where(eq(recipeStep.recipeId, id)).run();
  tx.delete(recipeTag).where(eq(recipeTag.recipeId, id)).run();
  writeParts(tx, id, content);
  writePhotos(tx, id, photoUses(content));
  if (!keepDraft) tx.delete(recipeDraft).where(eq(recipeDraft.recipeId, id)).run();
  recordPublished(tx, id, editorId, message);
  enqueueJob(tx, indexRecipeJob, { recipeId: id });
  return { ok: true, id };
}

/** `publishContent` in a transaction of its own: what saving the editor's changes does. */
export function updateRecipe(
  db: Db,
  id: string,
  content: RecipeContent,
  editorId: string,
  version: number,
  options: { message?: string | null } = {},
): SaveResult {
  return db.transaction((tx) => publishContent(tx, id, content, editorId, version, options));
}

/**
 * Makes a recipe private or shared, if it's still at `version`. The visibility it already has
 * changes nothing, the version included. Making it private takes away its public link, if it has
 * one, recorded in the audit log: only a shared recipe has one.
 */
export function setRecipeVisibility(
  db: Db,
  origin: AuditOrigin,
  id: string,
  visibility: Visibility,
  version: number,
): WriteResult {
  return db.transaction((tx): WriteResult => {
    const current = atVersion(tx, id, version);
    if (!current.ok) return current;
    const linked = tx
      .select({ token: recipe.publicToken })
      .from(recipe)
      .where(eq(recipe.id, id))
      .get();
    const [updated] = tx
      .update(recipe)
      .set({
        visibility,
        version: version + 1,
        ...(visibility === 'private' && { publicToken: null }),
      })
      .where(and(liveAt(id, version), ne(recipe.visibility, visibility)))
      .returning({ title: recipe.title })
      .all();
    if (!updated) return { ok: true };
    enqueueJob(tx, indexRecipeJob, { recipeId: id });
    if (visibility === 'private' && linked !== undefined && linked.token !== null) {
      recordAuditEvent(tx, origin, {
        action: 'public_link.revoked',
        target: { type: 'recipe', id },
        metadata: {
          ...auditedRecipe({ title: updated.title, visibility }),
          reason: 'made private',
        },
      });
    }
    return { ok: true };
  });
}

/**
 * How an audit event names a recipe: by its title only while it's shared. Admins read the log and
 * may not see private recipes, so a private recipe's title never enters it.
 */
export const auditedRecipe = ({ title, visibility }: { title: string; visibility: Visibility }) =>
  visibility === 'shared' ? { title, visibility } : { visibility };

/**
 * Moves a recipe to the trash (spec §3.2): it's hidden everywhere from now on, as if it didn't
 * exist, until it's restored (`trash/trash.ts`) or purged. When it was last changed stays, since
 * deleting doesn't change it. Refused if the recipe is already gone or no longer at `version`.
 */
export function deleteRecipe(
  db: Db,
  origin: AuditOrigin,
  id: string,
  version: number,
): WriteResult {
  return db.transaction((tx): WriteResult => {
    const current = atVersion(tx, id, version);
    if (!current.ok) return current;
    const [deleted] = tx
      .update(recipe)
      .set({ deletedAt: new Date(), version: version + 1, updatedAt: sql`${recipe.updatedAt}` })
      .where(liveAt(id, version))
      .returning({ title: recipe.title, visibility: recipe.visibility })
      .all();
    if (!deleted) return { ok: false, reason: 'stale' };
    enqueueJob(tx, indexRecipeJob, { recipeId: id });
    recordAuditEvent(tx, origin, {
      action: 'recipe.deleted',
      target: { type: 'recipe', id },
      metadata: auditedRecipe(deleted),
    });
    return { ok: true };
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

/** What authorizing restoring a recipe in the trash needs. `undefined` unless it's in the trash. */
export function findTrashedAccess(db: Db | Tx, id: string): PolicyRecipe | undefined {
  return db
    .select({ ownerId: recipe.ownerId, visibility: recipe.visibility })
    .from(recipe)
    .where(and(eq(recipe.id, id), isNotNull(recipe.deletedAt)))
    .get();
}

/**
 * The whole recipe as the API shows it. `undefined` if it doesn't exist, or was deleted unless
 * `includeDeleted`.
 */
export function loadRecipe(
  db: Db | Tx,
  id: string,
  { includeDeleted = false } = {},
): Recipe | undefined {
  const found = db
    .select({ row: recipe, ownerName: user.name })
    .from(recipe)
    .innerJoin(user, eq(user.id, recipe.ownerId))
    .where(includeDeleted ? eq(recipe.id, id) : live(id))
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
    revision: latestRevision(db, id),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
