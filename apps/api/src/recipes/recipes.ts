import {
  type CreateRecipeRequest,
  normalizeIngredientName,
  type PolicyRecipe,
  type Recipe,
  TAG_TYPES,
} from '@myli/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/database.ts';
import { recipe, recipeIngredient, recipeStep, recipeTag, tag, user } from '../db/schema.ts';

/**
 * Recipes (spec §3.2). Until Phase 2 adds drafts, saving writes the one live version directly, and
 * the last save wins. A deleted recipe is hidden everywhere, exactly as if it didn't exist.
 */

/** Everything about a recipe that editing it sets: the request bodies without the visibility. */
export type RecipeContent = Omit<CreateRecipeRequest, 'visibility'>;

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

  const steps = content.steps.map((step, position) => ({ recipeId, position, bodyMd: step.body }));
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

export type SaveResult = { ok: true; id: string } | { ok: false; missingTags: number[] };

/** Creates a recipe owned by `ownerId`, unless one of its tags doesn't exist. */
export function createRecipe(db: Db, ownerId: string, request: CreateRecipeRequest): SaveResult {
  return db.transaction((tx): SaveResult => {
    const missingTags = missingTagIndexes(tx, request.tagIds);
    if (missingTags.length > 0) return { ok: false, missingTags };

    const { id } = tx
      .insert(recipe)
      .values({ ownerId, visibility: request.visibility, ...contentColumns(request) })
      .returning({ id: recipe.id })
      .get();
    writeParts(tx, id, request);
    return { ok: true, id };
  });
}

/** What authorizing an action on a recipe needs. `undefined` if it doesn't exist or was deleted. */
export function findRecipeAccess(db: Db | Tx, id: string): PolicyRecipe | undefined {
  return db
    .select({ ownerId: recipe.ownerId, visibility: recipe.visibility })
    .from(recipe)
    .where(and(eq(recipe.id, id), isNull(recipe.deletedAt)))
    .get();
}

/** The whole recipe as the API shows it. `undefined` if it doesn't exist or was deleted. */
export function loadRecipe(db: Db | Tx, id: string): Recipe | undefined {
  const found = db
    .select({ row: recipe, ownerName: user.name })
    .from(recipe)
    .innerJoin(user, eq(user.id, recipe.ownerId))
    .where(and(eq(recipe.id, id), isNull(recipe.deletedAt)))
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

  const steps = db
    .select({ body: recipeStep.bodyMd })
    .from(recipeStep)
    .where(eq(recipeStep.recipeId, id))
    .orderBy(asc(recipeStep.position))
    .all();

  const tags = db
    .select({ id: tag.id, type: tag.type, name: tag.name, nameKey: tag.nameKey })
    .from(recipeTag)
    .innerJoin(tag, eq(tag.id, recipeTag.tagId))
    .where(eq(recipeTag.recipeId, id))
    .all()
    .sort(
      (a, b) =>
        TAG_TYPES.indexOf(a.type) - TAG_TYPES.indexOf(b.type) || a.nameKey.localeCompare(b.nameKey),
    )
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
