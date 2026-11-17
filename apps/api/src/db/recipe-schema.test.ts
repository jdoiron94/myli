import { ALLERGENS, tagNameKey } from '@myli/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './database.ts';
import { recipe, recipeIngredient, recipeStep, recipeTag, tag, user } from './schema.ts';
import { createTestDatabase } from './testing.ts';

let db: Db;
let ownerId: string;

beforeEach(() => {
  db = createTestDatabase();
  ownerId = db
    .insert(user)
    .values({ id: 'owner', name: 'Owner', email: 'owner@example.com' })
    .returning()
    .get().id;
});

type RecipeRow = typeof recipe.$inferInsert;

function insertRecipe(values: Partial<RecipeRow> = {}) {
  return db
    .insert(recipe)
    .values({ ownerId, visibility: 'shared', title: 'Bread', servings: 4, ...values })
    .returning()
    .get();
}

type IngredientRow = typeof recipeIngredient.$inferInsert;

function insertIngredient(recipeId: string, values: Partial<IngredientRow> = {}) {
  return db
    .insert(recipeIngredient)
    .values({
      recipeId,
      groupPosition: 0,
      position: 0,
      rawText: '2 cups flour',
      qty: 2,
      unit: 'cup',
      name: 'flour',
      normalizedName: 'flour',
      ...values,
    })
    .run();
}

describe('the allergen tags', () => {
  it('are seeded: exactly the shared list, in order', () => {
    const rows = db.select().from(tag).where(eq(tag.type, 'allergen')).orderBy(tag.id).all();
    expect(rows.map(({ name }) => name)).toEqual([...ALLERGENS]);
    expect(rows.every(({ name, nameKey }) => nameKey === tagNameKey(name))).toBe(true);
  });

  it('are the only tags on a new instance', () => {
    expect(db.select().from(tag).all()).toHaveLength(ALLERGENS.length);
  });
});

describe('recipe', () => {
  it('gets a UUID and defaults for what it leaves out', () => {
    const row = insertRecipe();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row).toMatchObject({ descriptionMd: '', equipment: [], deletedAt: null });
  });

  it.each<[string, Partial<RecipeRow>]>([
    ['an unknown visibility', { visibility: 'public' as never }],
    ['an unknown difficulty', { difficulty: 'expert' as never }],
    ['no servings', { servings: 0 }],
    ['a yield of nothing', { yieldQty: 0 }],
    ['a yield unit without a quantity', { yieldUnit: 'loaves' }],
    ['negative minutes', { cookMin: -1 }],
    ['negative nutrition', { nutritionSodiumMg: -5 }],
  ])('refuses %s', (_, values) => {
    expect(() => insertRecipe(values)).toThrow(/CHECK constraint failed/);
  });

  it('refuses an owner who is not a user', () => {
    expect(() => insertRecipe({ ownerId: 'nobody' })).toThrow(/FOREIGN KEY/);
  });

  it('takes its lines, steps and tags with it when the row is deleted (a purge, in Phase 2)', () => {
    const { id } = insertRecipe();
    insertIngredient(id);
    db.insert(recipeStep).values({ recipeId: id, position: 0, bodyMd: 'Mix.' }).run();
    const milk = db.select().from(tag).where(eq(tag.name, 'milk')).get();
    db.insert(recipeTag)
      .values({ recipeId: id, tagId: milk?.id ?? 0 })
      .run();

    db.delete(recipe).where(eq(recipe.id, id)).run();
    expect(db.select().from(recipeIngredient).all()).toEqual([]);
    expect(db.select().from(recipeStep).all()).toEqual([]);
    expect(db.select().from(recipeTag).all()).toEqual([]);
    expect(db.select().from(tag).all()).toHaveLength(ALLERGENS.length);
  });
});

describe('recipe_ingredient', () => {
  it('stores a range, and a line without a quantity', () => {
    const { id } = insertRecipe();
    insertIngredient(id, { qty: 2, qtyMax: 3, unit: 'clove', name: 'garlic', position: 0 });
    insertIngredient(id, { qty: null, unit: null, name: 'salt', scalable: false, position: 1 });
    expect(db.select().from(recipeIngredient).all()).toHaveLength(2);
  });

  it.each<[string, Partial<IngredientRow>]>([
    ['a quantity of nothing', { qty: 0 }],
    ['a range without a bottom', { qty: null, qtyMax: 3 }],
    ['a range that goes down', { qty: 3, qtyMax: 2 }],
    ['a range of one value', { qty: 2, qtyMax: 2 }],
  ])('refuses %s', (_, values) => {
    const { id } = insertRecipe();
    expect(() => insertIngredient(id, values)).toThrow(/CHECK constraint failed/);
  });

  it('refuses two lines in one place', () => {
    const { id } = insertRecipe();
    insertIngredient(id);
    expect(() => insertIngredient(id)).toThrow(/UNIQUE constraint failed/);
  });
});

describe('tag', () => {
  it('refuses an unknown type', () => {
    expect(() =>
      db
        .insert(tag)
        .values({ type: 'season' as never, name: 'Summer', nameKey: 'summer' })
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('allows a name once per type, and the same name in another type', () => {
    db.insert(tag).values({ type: 'cuisine', name: 'Italian', nameKey: 'italian' }).run();
    db.insert(tag).values({ type: 'custom', name: 'italian', nameKey: 'italian' }).run();
    expect(() =>
      db.insert(tag).values({ type: 'cuisine', name: 'ITALIAN', nameKey: 'italian' }).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });
});

describe('tagNameKey', () => {
  it.each([
    ['Italian', 'italian'],
    ['  Middle   Eastern ', 'middle eastern'],
    ['CAFÉ', 'café'],
    ['ｖｅｇａｎ', 'vegan'],
  ])('makes %j %j', (name, key) => {
    expect(tagNameKey(name)).toBe(key);
  });
});
