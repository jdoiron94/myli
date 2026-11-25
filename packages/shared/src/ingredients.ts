import type { Amount } from './quantities.ts';
import { findUnit } from './units.ts';

/**
 * Reading ingredient lines (spec §3.2). The parser's result is a suggestion the user confirms or
 * corrects, so it aims for the common cases and fails safely: whatever it can't read stays in the
 * name, and the line's raw text is always kept as typed.
 */

/** What the parser reads from a line: its amount (a unit from the unit table), name and note. */
export interface ParsedIngredient extends Amount {
  /** What the ingredient is: "all-purpose flour". Empty if the line names nothing. */
  name: string;
  /** Everything said about it: "minced", "14 oz, drained". */
  note: string | null;
  /** False for lines like "salt to taste" or "oil for frying", which scaling leaves alone. */
  scalable: boolean;
}

// Maps, not objects: a name like "constructor" must never find something on Object.prototype.
const UNICODE_FRACTIONS = new Map([
  ['½', 1 / 2],
  ['⅓', 1 / 3],
  ['⅔', 2 / 3],
  ['¼', 1 / 4],
  ['¾', 3 / 4],
  ['⅕', 1 / 5],
  ['⅖', 2 / 5],
  ['⅗', 3 / 5],
  ['⅘', 4 / 5],
  ['⅙', 1 / 6],
  ['⅚', 5 / 6],
  ['⅛', 1 / 8],
  ['⅜', 3 / 8],
  ['⅝', 5 / 8],
  ['⅞', 7 / 8],
]);

const NUMBER_WORDS = new Map(
  [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
  ].map((word, index) => [word, index + 1]),
);

const FRACTION_CHARACTERS = [...UNICODE_FRACTIONS.keys()].join('');

/**
 * One quantity: "1 1/2", "1-1/2" (as older American recipes write it), "3/4", "1½", "½", ".5", "2",
 * "two". Mixed numbers come first, so "1 1/2" isn't read as 1.
 */
const NUMBER = String.raw`(?:\d+(?:\s+|-)\d+\s*/\s*\d+|\d+\s*/\s*\d+|\d+\s*[${FRACTION_CHARACTERS}]|[${FRACTION_CHARACTERS}]|\d*\.\d+|\d+|(?:${[...NUMBER_WORDS.keys()].join('|')})\b)`;

/** A quantity or a range at the start of a line: "2", "2-3", "2 to 3", "1½–2". */
const QUANTITY = new RegExp(
  String.raw`^(${NUMBER})(?:\s*(?:-|–|—|\bto\b|\bor\b)\s*(${NUMBER}))?`,
  'i',
);

/** "A" or "an" meaning one: not in "a few", "a little", "a bit", "a couple". */
const ARTICLE = /^an?\s+(?!(?:few|little|bit|couple)\b)/i;

/** Phrases at the end of a name that say how much or what for, not what it is. */
const TRAILING_NOTE =
  /\s+(to taste|as needed|for (?:serving|garnish|garnishing|frying|greasing|dusting|brushing)|optional)$/i;

/**
 * Lines that don't scale: "salt to taste", "oil as needed", and amounts that depend on the pan or
 * the counter rather than the servings: "oil for frying", "butter for greasing", "flour for dusting".
 */
const NOT_SCALABLE = /\b(?:to taste|as needed|for (?:frying|deep frying|greasing|dusting))\b/i;

/**
 * A remark in parentheses: "(14 oz)". It can't contain "(", so each match stops at the next one,
 * where `[^)]*` would scan to the end of a line full of unclosed parentheses, for each of them. No
 * `\s*` before it either, which would scan a long run of spaces from each of them: collapsing
 * whitespace afterwards removes the gap a remark leaves.
 */
const REMARK = /\(([^()]*)\)/g;

/** A remark at the start of what follows a quantity: the size in "1 (14 oz) can". */
const SIZE = /^\(([^()]*)\)\s*/;

/**
 * `text` without the characters `pattern` matches at its end. A loop, because a regex like
 * `/[,;]+$/` tries every start in a long run of them, which takes quadratic time.
 */
function trimEnd(text: string, pattern: RegExp): string {
  let end = text.length;
  while (end > 0 && pattern.test(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

function numberValue(text: string): number {
  const trimmed = text.trim().toLowerCase();
  const word = NUMBER_WORDS.get(trimmed);
  if (word !== undefined) return word;
  const unicode = UNICODE_FRACTIONS.get(trimmed.at(-1) ?? '');
  if (unicode !== undefined) {
    const whole = trimmed.slice(0, -1).trim();
    return (whole === '' ? 0 : Number(whole)) + unicode;
  }
  const mixed = /^(\d+)(?:\s+|-)(\d+)\s*\/\s*(\d+)$/.exec(trimmed);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(trimmed);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return Number(trimmed);
}

const WHOLE_QUANTITY = new RegExp(String.raw`^${NUMBER}$`, 'i');

/**
 * One quantity typed on its own, as the parser reads it at the start of a line: "1 1/2", "1½",
 * "3/4", "2.5", "two". `undefined` for anything else, and for 0 or less, which isn't an amount.
 */
export function parseQuantity(text: string): number | undefined {
  const trimmed = text.replace(/⁄/g, '/').replace(/\s+/g, ' ').trim();
  if (!WHOLE_QUANTITY.test(trimmed)) return undefined;
  const value = numberValue(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** A unit at the start of `text`, one or two words long, and what follows it. */
function readUnit(text: string): { unit: string; rest: string } | undefined {
  const words = /^(\S+)(?:\s+(\S+))?/.exec(text);
  if (!words) return undefined;
  const [, first = '', second] = words;
  const candidates = second === undefined ? [first] : [`${first} ${second}`, first];
  for (const candidate of candidates) {
    // A unit may run straight into punctuation: "2 cups, divided". A comma stays in what follows,
    // where it starts the note, as anywhere else.
    for (const spelling of [candidate, candidate.replace(/[,;:.]$/, '')]) {
      const unit = findUnit(spelling);
      if (unit) return { unit: unit.name, rest: text.slice(spelling.length) };
    }
  }
  return undefined;
}

/** Reads `rawText` into its quantity, unit, name and note. Never throws. */
export function parseIngredient(rawText: string): ParsedIngredient {
  let text = rawText
    .replace(/⁄/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    // A pasted list's bullet.
    .replace(/^[-*•]\s+/, '');
  const notes: string[] = [];

  let qty: number | null = null;
  let qtyMax: number | null = null;
  const quantity = QUANTITY.exec(text);
  const low = quantity ? numberValue(quantity[1] ?? '') : Number.NaN;
  const high = quantity?.[2] === undefined ? low : numberValue(quantity[2]);
  // "0 cups" or "1/0 cup" isn't a quantity: it stays in the name for the user to correct.
  if (quantity && [low, high].every((value) => Number.isFinite(value) && value > 0)) {
    // "3–2 cups" is a range written backwards.
    qty = Math.min(low, high);
    qtyMax = high === low ? null : Math.max(low, high);
    text = text.slice(quantity[0].length).trim();
  }

  // "1 (14 oz) can tomatoes": the size is a note.
  for (let size = SIZE.exec(text); size; size = SIZE.exec(text)) {
    if (size[1]?.trim()) notes.push(size[1].trim());
    text = text.slice(size[0].length);
  }

  const article = qty === null ? ARTICLE.exec(text) : null;
  if (article) text = text.slice(article[0].length);

  let unit: string | null = null;
  const unitRead = readUnit(text);
  // Without a quantity, a unit counts only before "of": "pinch of salt" is one pinch.
  const bare = qty === null && !article;
  if (unitRead && (!bare || /^\s*of\b/i.test(unitRead.rest))) {
    unit = unitRead.unit;
    text = unitRead.rest.trim().replace(/^of\s+/i, '');
    qty ??= 1;
  } else if (article) {
    qty = 1;
  }

  // Parenthetical remarks anywhere, then whatever follows the first comma.
  // A space in place of each, so "salt(fine)pepper" doesn't become one word.
  let name = text.replace(REMARK, (_, remark: string) => {
    if (remark.trim()) notes.push(remark.trim());
    return ' ';
  });
  const comma = name.indexOf(',');
  if (comma >= 0) {
    const after = name.slice(comma + 1).trim();
    name = name.slice(0, comma);
    if (after) notes.push(after);
  }
  const trailing = TRAILING_NOTE.exec(name);
  if (trailing) {
    name = name.slice(0, trailing.index);
    notes.push(trailing[1] ?? '');
  }
  name = trimEnd(name.replace(/\s+/g, ' ').replace(/^[\s,;:.-]+/, ''), /[\s,;:.]/);

  return {
    qty,
    qtyMax,
    unit,
    name,
    note: notes.length > 0 ? notes.join(', ') : null,
    scalable: !NOT_SCALABLE.test(rawText),
  };
}

/** Plural nouns that don't follow the rules below, and their singulars. */
const IRREGULAR = new Map([
  ['leaves', 'leaf'],
  ['loaves', 'loaf'],
  ['halves', 'half'],
  ['knives', 'knife'],
  ['potatoes', 'potato'],
  ['tomatoes', 'tomato'],
  ['mangoes', 'mango'],
  ['avocadoes', 'avocado'],
  ['quiches', 'quiche'],
  ['brioches', 'brioche'],
  ['ganaches', 'ganache'],
  ['cookies', 'cookie'],
  ['brownies', 'brownie'],
  ['pies', 'pie'],
  ['smoothies', 'smoothie'],
  ['veggies', 'veggie'],
  ['chilies', 'chili'],
  ['chillies', 'chilli'],
]);

/** Words that end in "s" without being plurals, or that are always plural. */
const UNCHANGED = new Set(['molasses', 'brussels', 'grits', 'bitters', 'greens']);

/** The singular of `word`. The singular of a singular is itself. */
function singular(word: string): string {
  const irregular = IRREGULAR.get(word);
  if (irregular !== undefined) return irregular;
  if (UNCHANGED.has(word) || word.length <= 3 || /(?:ss|us|is)$/.test(word)) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  // "glasses", "boxes", "peaches", "dishes"; but "cheeses", "glazes" and "sauces" only lose the "s".
  if (/(?:ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * The name used to find recipes by ingredient and to add up grocery lists (spec §3.2): lowercase,
 * without accents, the note or punctuation, with its last word singular. "Cherry Tomatoes, halved"
 * is "cherry tomato", and "Jalapeños" and "jalapeno" are both "jalapeno". Normalizing a normalized
 * name changes nothing.
 */
export function normalizeIngredientName(name: string): string {
  // Remarks first, since one can hold a comma: "dark (70%, bittersweet) chocolate".
  const words = (name.replace(REMARK, ' ').split(',')[0] ?? '')
    // Before decomposing, which would make "Tabasco™" "TabascoTM".
    .replace(/[™℠]/g, ' ')
    // Lowercased on both sides of decomposing: "𝐇" decomposes to "H", and "İ" lowercases to "i̇".
    .toLowerCase()
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    // "Confectioners' sugar" is "confectioners sugar", and "all-purpose" is "all purpose".
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
  const last = words.length - 1;
  return words.map((word, index) => (index === last ? singular(word) : word)).join(' ');
}
