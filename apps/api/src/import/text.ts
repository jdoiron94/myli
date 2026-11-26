import { decodeHTML } from 'entities';

/** Tags that end a line of text, as a browser would show them. */
const LINE_ENDS = /<br\s*\/?>|<\/(?:p|li|div|h[1-6]|tr)\s*>/gi;
const TAG = /<[^>]*>/g;
const ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i;

/**
 * The text a value from another site's data holds, as its page would show it: tags taken out,
 * entities decoded (twice, since some sites encode them twice), spaces tidied, and a line for each
 * of its lines or paragraphs. Empty for anything that isn't a string or a number.
 */
export function textLines(value: unknown): string[] {
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (typeof value !== 'string') return [];
  let text = value.replace(LINE_ENDS, '\n').replace(TAG, '');
  for (let pass = 0; pass < 2 && ENTITY.test(text); pass++) text = decodeHTML(text);
  return text
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
}

/** The same text on one line. */
export const plainText = (value: unknown) => textLines(value).join(' ');

/**
 * Text written as markdown that shows exactly as it reads (spec §3.2's subset, which keeps line
 * breaks): what would format it, link it or start a list is escaped.
 */
export function asMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<]/g, '\\$&')
    .replace(/&(?=#?[a-z\d]+;)/gi, '\\&')
    .replace(/^([-+])(?=\s)/gm, '\\$1')
    .replace(/^(\d+)([.)])(?=\s)/gm, '$1\\$2');
}

/** At most `max` characters, trimmed, never ending halfway through an escape. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const clipped = text.slice(0, max).trimEnd();
  return /(?:^|[^\\])(?:\\\\)*\\$/.test(clipped) ? clipped.slice(0, -1).trimEnd() : clipped;
}
