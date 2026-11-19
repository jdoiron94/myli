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

/** Which constraint, if any, refuses an insert. */
function refusal(insert: () => unknown) {
  try {
    insert();
    return 'inserted';
  } catch (error) {
    return /CHECK|FOREIGN KEY|UNIQUE/.exec(String(error))?.[0] ?? String(error);
  }
}

describe('the allergen tags', () => {
  it('are seeded, exactly the shared list in order, and the only tags on a new instance', () => {
    const rows = db.select().from(tag).orderBy(tag.id).all();
    expect(rows.map(({ type, name }) => `${type}:${name}`)).toEqual(
      ALLERGENS.map((name) => `allergen:${name}`),
    );
    expect(rows.every(({ name, nameKey }) => nameKey === tagNameKey(name))).toBe(true);
  });
});

describe('recipe', () => {
  it('gets a UUID and defaults for what it leaves out', () => {
    const row = insertRecipe();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row).toMatchObject({ descriptionMd: '', equipment: [], deletedAt: null });
  });

  it('refuses a row the app would never write', () => {
    const rows: Record<string, Partial<RecipeRow>> = {
      'an unknown visibility': { visibility: 'public' as never },
      'an unknown difficulty': { difficulty: 'expert' as never },
      'no servings': { servings: 0 },
      'a yield of nothing': { yieldQty: 0 },
      'a yield unit without a quantity': { yieldUnit: 'loaves' },
      'negative minutes': { cookMin: -1 },
      'negative nutrition': { nutritionSodiumMg: -5 },
      'an owner who is not a user': { ownerId: 'nobody' },
    };

    expect(
      Object.fromEntries(
        Object.entries(rows).map(([name, values]) => [name, refusal(() => insertRecipe(values))]),
      ),
    ).toEqual({
      'an unknown visibility': 'CHECK',
      'an unknown difficulty': 'CHECK',
      'no servings': 'CHECK',
      'a yield of nothing': 'CHECK',
      'a yield unit without a quantity': 'CHECK',
      'negative minutes': 'CHECK',
      'negative nutrition': 'CHECK',
      'an owner who is not a user': 'FOREIGN KEY',
    });
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

  it('refuses a line the app would never write', () => {
    const { id } = insertRecipe();
    insertIngredient(id, { position: 0 });
    const lines: Record<string, Partial<IngredientRow>> = {
      'a quantity of nothing': { qty: 0, position: 1 },
      'a range without a bottom': { qty: null, qtyMax: 3, position: 1 },
      'a range that goes down': { qty: 3, qtyMax: 2, position: 1 },
      'a range of one value': { qty: 2, qtyMax: 2, position: 1 },
      'two lines in one place': { position: 0 },
    };

    expect(
      Object.fromEntries(
        Object.entries(lines).map(([name, values]) => [
          name,
          refusal(() => insertIngredient(id, values)),
        ]),
      ),
    ).toEqual({
      'a quantity of nothing': 'CHECK',
      'a range without a bottom': 'CHECK',
      'a range that goes down': 'CHECK',
      'a range of one value': 'CHECK',
      'two lines in one place': 'UNIQUE',
    });
  });
});

describe('tag', () => {
  it('has a known type, and each name once per type', () => {
    const insert = (type: string, name: string) => () =>
      db
        .insert(tag)
        .values({ type: type as never, name, nameKey: tagNameKey(name) })
        .run();

    expect(
      [
        insert('season', 'Summer'),
        insert('cuisine', 'Italian'),
        insert('custom', 'italian'),
        insert('cuisine', 'ITALIAN'),
      ].map(refusal),
    ).toEqual(['CHECK', 'inserted', 'inserted', 'UNIQUE']);
  });
});

describe('tagNameKey', () => {
  it('folds case, spacing and width', () => {
    expect(['Italian', '  Middle   Eastern ', 'CAFÉ', 'ｖｅｇａｎ'].map(tagNameKey)).toEqual([
      'italian',
      'middle eastern',
      'café',
      'vegan',
    ]);
  });
});
