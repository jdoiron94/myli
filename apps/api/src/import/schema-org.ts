import {
  type ImportedRecipe,
  ingredientLineInputSchema,
  RECIPE_LIMITS as L,
  parseIngredient,
  type TagType,
} from '@myli/shared';
import { asMarkdown, clip, plainText, textLines } from './text.ts';

/** What a page's schema.org/Recipe data says, to fill in the New recipe form (spec §3.7). */
export interface SchemaOrgRecipe {
  /** Without photos or tags: those are the importer's to add. */
  recipe: ImportedRecipe;
  /** Its first photo's address, if it gives one. */
  imageUrl: string | null;
  /** The tags it names, which an import adds only where they already exist. */
  tags: { type: Extract<TagType, 'cuisine' | 'meal_type' | 'diet'>; name: string }[];
}

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const list = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

/**
 * The JSON-LD blocks of an HTML page. A block that isn't valid JSON is tried once more with its
 * control characters as spaces: some sites put line breaks inside its strings.
 */
const JSON_LD =
  /<script\b[^>]*?\btype\s*=\s*["']?application\/ld\+json\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

function jsonLdValues(html: string): unknown[] {
  const values: unknown[] = [];
  for (const [, block = ''] of html.matchAll(JSON_LD)) {
    const text = block
      .trim()
      .replace(/^<!--|-->$/g, '')
      .replace(/^\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>$/g, '');
    // eslint-disable-next-line no-control-regex -- control characters are what it replaces.
    for (const attempt of [text, text.replace(/[\u0000-\u001f]+/g, ' ')]) {
      try {
        values.push(JSON.parse(attempt));
        break;
      } catch {
        // The next attempt, or none.
      }
    }
  }
  return values;
}

/** Every object in the data, however it's nested: `@graph`, lists, a page's `mainEntity`. */
function nodesOf(values: unknown[]): Node[] {
  const nodes: Node[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 20 || nodes.length > 10_000) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else if (isNode(value)) {
      nodes.push(value);
      for (const child of Object.values(value)) visit(child, depth + 1);
    }
  };
  for (const value of values) visit(value, 0);
  return nodes;
}

const isRecipe = (node: Node) =>
  list(node['@type']).some((type) => typeof type === 'string' && /(?:^|[/:])Recipe$/.test(type));

/**
 * Reads the schema.org/Recipe data in a page, or `null` if it has none. A page can hold several:
 * the first that lists ingredients, or else the first.
 */
export function readSchemaOrgRecipe(html: string, pageUrl: URL): SchemaOrgRecipe | null {
  const nodes = nodesOf(jsonLdValues(html));
  const recipes = nodes.filter(isRecipe);
  const recipe = recipes.find((node) => node.recipeIngredient !== undefined) ?? recipes[0];
  if (!recipe) return null;

  // A node that's only `{ "@id": … }` stands for the one with that ID, as an author often does.
  const byId = new Map<unknown, Node>();
  for (const node of nodes) {
    if (typeof node['@id'] === 'string' && Object.keys(node).length > 1)
      byId.set(node['@id'], node);
  }
  const resolve = (value: unknown) =>
    isNode(value) && Object.keys(value).length === 1 ? (byId.get(value['@id']) ?? value) : value;
  const nameOf = (value: unknown) => {
    const resolved = resolve(value);
    return plainText(isNode(resolved) ? resolved.name : resolved);
  };

  const { servings, made } = yields(recipe.recipeYield);
  const prepMinutes = minutes(recipe.prepTime);
  const cookMinutes = minutes(recipe.cookTime);
  const totalMinutes = minutes(recipe.totalTime);
  const authors = list(recipe.author).map(nameOf).filter(Boolean);

  return {
    recipe: {
      title: clip(
        plainText(recipe.name) ||
          plainText(recipe.headline) ||
          pageTitle(html) ||
          'Untitled recipe',
        L.title,
      ),
      description: clip(asMarkdown(textLines(recipe.description).join('\n')), L.description),
      source: {
        url: pageUrl.href.length <= L.sourceUrl ? withoutFragment(pageUrl) : null,
        title: clip(
          nameOf(recipe.publisher) || pageUrl.hostname.replace(/^www\./, ''),
          L.sourceText,
        ),
        author: clip(authors.join(', '), L.sourceText) || null,
      },
      equipment: list(recipe.tool)
        .map(nameOf)
        .filter(Boolean)
        .slice(0, L.equipment)
        .map((item) => clip(item, L.equipmentItem)),
      yield: made,
      servings,
      prepMinutes,
      cookMinutes,
      // Only when it isn't their sum, which the recipe shows on its own.
      totalMinutes:
        totalMinutes !== null && totalMinutes !== (prepMinutes ?? 0) + (cookMinutes ?? 0)
          ? totalMinutes
          : null,
      difficulty: null,
      nutrition: nutrition(resolve(recipe.nutrition)),
      ingredientGroups: ingredientGroups(recipe.recipeIngredient ?? recipe.ingredients),
      steps: steps(recipe.recipeInstructions, resolve).map((body) => ({ body, image: null })),
      images: [],
      coverImageId: null,
      tagIds: [],
    },
    imageUrl: imageUrl(recipe.image, pageUrl, resolve),
    tags: [
      ...names(recipe.recipeCuisine).map((name) => ({ type: 'cuisine' as const, name })),
      ...names(recipe.recipeCategory).map((name) => ({ type: 'meal_type' as const, name })),
      ...list(recipe.suitableForDiet)
        .map((diet) => dietName(isNode(diet) ? (diet['@id'] ?? diet.name) : diet))
        .filter(Boolean)
        .map((name) => ({ type: 'diet' as const, name })),
    ],
  };
}

const pageTitle = (html: string) =>
  plainText(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]);

function withoutFragment(url: URL) {
  const copy = new URL(url);
  copy.hash = '';
  return copy.href;
}

/** "Italian, Mediterranean" and ["Italian"] alike: each name once. */
const names = (value: unknown) => [
  ...new Set(
    list(value)
      .flatMap((item) => plainText(item).split(/\s*,\s*/))
      .filter(Boolean),
  ),
];

/** "https://schema.org/GlutenFreeDiet" is "Gluten Free"; a diet written out stays as it is. */
function dietName(value: unknown) {
  const text = plainText(value);
  const term = /^(?:https?:\/\/schema\.org\/|schema:)?([A-Za-z]+)Diet$/.exec(text)?.[1];
  return term ? term.replace(/(?<=[a-z])(?=[A-Z])/g, ' ') : text;
}

const NUMBER = /(\d+(?:\.\d+)?)/;

/** A number as sites write it: "1,200" is twelve hundred, "1,5" one and a half. */
const readNumber = (text: string) => {
  const match = NUMBER.exec(
    text.replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d),(\d)/g, '$1.$2'),
  );
  return match ? { value: Number(match[1]), index: match.index, length: match[0].length } : null;
};

/**
 * The servings and what it makes, from `recipeYield`, which sites write many ways: "4", "4
 * servings", "Serves 4–6" (the fewest), "12 cookies", or a list of those.
 */
function yields(value: unknown): { servings: number | null; made: ImportedRecipe['yield'] } {
  let servings: number | null = null;
  let made: ImportedRecipe['yield'] = null;
  for (const item of list(value)) {
    const text = plainText(item);
    const number = readNumber(text);
    if (!number || number.value <= 0) continue;
    const before = text.slice(0, number.index).trim();
    const after = text
      .slice(number.index + number.length)
      .replace(/^\s*(?:-|–|—|to)\s*\d+(?:[.,]\d+)?/, '')
      .trim();
    const isServings =
      after === '' ||
      /^(?:servings?|people|persons?|portions?)\b/i.test(after) ||
      /\bserves?\b|\bservings?\b/i.test(before);
    if (isServings) {
      const whole = Math.round(number.value);
      if (servings === null && whole >= 1 && whole <= L.servings) servings = whole;
    } else if (made === null && number.value <= L.quantity) {
      made = { qty: number.value, unit: clip(after, L.yieldUnit) || null };
    }
  }
  return { servings, made };
}

const DURATION =
  /^P(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i;
const MINUTES_IN = [7 * 24 * 60, 24 * 60, 60, 1, 1 / 60];

/** An ISO 8601 duration ("PT1H30M") in whole minutes, or `null`. */
function minutes(value: unknown): number | null {
  // Groups that didn't match are undefined, which the array's type doesn't say.
  const parts: (string | undefined)[] | undefined =
    typeof value === 'string' ? DURATION.exec(value.trim())?.slice(1) : undefined;
  if (!parts?.some((part) => part !== undefined)) return null;
  const total = Math.round(
    parts.reduce(
      (sum, part, index) =>
        sum + Number((part ?? '0').replace(',', '.')) * (MINUTES_IN[index] ?? 0),
      0,
    ),
  );
  return total <= L.minutes ? total : null;
}

/** What each of our nutrients is called in schema.org, and the unit we keep it in. */
const NUTRIENTS = {
  calories: ['calories', 'kcal'],
  proteinGrams: ['proteinContent', 'g'],
  carbsGrams: ['carbohydrateContent', 'g'],
  fatGrams: ['fatContent', 'g'],
  fiberGrams: ['fiberContent', 'g'],
  sugarGrams: ['sugarContent', 'g'],
  sodiumMilligrams: ['sodiumContent', 'mg'],
} as const;

/** How much of our unit each unit sites write is. */
const IN_UNIT: Record<'kcal' | 'g' | 'mg', Record<string, number>> = {
  kcal: { kj: 1 / 4.184 },
  g: { mg: 1 / 1000 },
  mg: { g: 1000, grams: 1000, gram: 1000 },
};

function nutrition(value: unknown): ImportedRecipe['nutrition'] {
  const facts = isNode(value) ? value : {};
  const read = ([property, unit]: readonly [string, 'kcal' | 'g' | 'mg']) => {
    const text = plainText(facts[property]);
    const number = readNumber(text);
    if (!number) return null;
    const written = /^\s*([a-z]+)/i.exec(text.slice(number.index + number.length))?.[1];
    const amount = number.value * (IN_UNIT[unit][written?.toLowerCase() ?? ''] ?? 1);
    return amount <= L.nutrition ? Math.round(amount * 10) / 10 : null;
  };
  return {
    calories: read(NUTRIENTS.calories),
    proteinGrams: read(NUTRIENTS.proteinGrams),
    carbsGrams: read(NUTRIENTS.carbsGrams),
    fatGrams: read(NUTRIENTS.fatGrams),
    fiberGrams: read(NUTRIENTS.fiberGrams),
    sugarGrams: read(NUTRIENTS.sugarGrams),
    sodiumMilligrams: read(NUTRIENTS.sodiumMilligrams),
  };
}

/**
 * The ingredients, in one group, each line read by the parser as a typed one is. A line it can't
 * make a valid record of keeps its text as its name, for the importer to look at.
 */
function ingredientGroups(value: unknown): ImportedRecipe['ingredientGroups'] {
  const lines = list(value)
    .flatMap(textLines)
    .slice(0, L.ingredients)
    .map((text) => {
      const rawText = clip(text, L.rawText);
      const line = { rawText, ...parseIngredient(rawText) };
      return ingredientLineInputSchema.safeParse(line).success
        ? line
        : {
            rawText,
            qty: null,
            qtyMax: null,
            unit: null,
            name: clip(rawText, L.ingredientName),
            note: null,
            scalable: true,
          };
    });
  return lines.length === 0 ? [] : [{ label: null, ingredients: lines }];
}

/**
 * The steps, as markdown that shows as the page wrote them. Instructions come as one string (a
 * step to a line or list item), a list of strings, `HowToStep`s, or `HowToSection`s of those, whose
 * name starts their first step, in bold.
 */
function steps(value: unknown, resolve: (value: unknown) => unknown): string[] {
  const bodies: string[] = [];
  const visit = (item: unknown, section: string | null, depth: number) => {
    const resolved = resolve(item);
    if (depth > 5 || bodies.length >= L.steps) return;
    const before = bodies.length;
    if (Array.isArray(resolved)) {
      for (const child of resolved) visit(child, null, depth + 1);
    } else if (isNode(resolved) && resolved.itemListElement !== undefined) {
      for (const child of list(resolved.itemListElement)) visit(child, null, depth + 1);
      section = plainText(resolved.name) || null;
    } else if (isNode(resolved)) {
      const text = textLines(resolved.text ?? resolved.description ?? resolved.name).join('\n');
      if (text) bodies.push(asMarkdown(unnumbered(text)));
    } else {
      bodies.push(...textLines(resolved).map(unnumbered).filter(Boolean).map(asMarkdown));
    }
    if (section && bodies.length > before) {
      bodies[before] = `**${asMarkdown(section)}**\n\n${bodies[before] ?? ''}`;
    }
  };
  visit(value, null, 0);
  return bodies.slice(0, L.steps).map((body) => clip(body, L.stepBody));
}

/** A step without the number a page gave it ("1.", "Step 2:"), since the recipe numbers its steps. */
const unnumbered = (text: string) => text.replace(/^(?:step\s*)?\d+\s*[.):](?:\s+|$)/i, '');

/** The first photo's address, made absolute, if it's an http(s) one. */
function imageUrl(
  value: unknown,
  pageUrl: URL,
  resolve: (value: unknown) => unknown,
): string | null {
  for (const item of list(value)) {
    const resolved = resolve(item);
    const address = isNode(resolved) ? (resolved.url ?? resolved.contentUrl) : resolved;
    if (typeof address !== 'string') continue;
    try {
      const url = new URL(address.trim(), pageUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch {
      // The next one.
    }
  }
  return null;
}
