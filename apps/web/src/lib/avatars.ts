/**
 * The colors of the circle that shows someone's initials when they have no profile photo. Each is
 * dark enough for white text to meet WCAG AA (4.5:1); the circle is the same in both themes.
 */
export const AVATAR_COLORS = [
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#0f766e',
  '#0369a1',
  '#1d4ed8',
  '#6d28d9',
  '#a21caf',
  '#be123c',
] as const;

/** The color of someone's circle, from their ID, so it's the same wherever they show. */
export function avatarColor(userId: string): string {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/**
 * Up to two letters for a name: the first letter or digit of its first word that has one, and of
 * its last. Empty when no word has one, as for a name that's an emoji.
 */
export function initials(name: string): string {
  const letters = name.split(/\s+/u).flatMap((word) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? []);
  const first = letters[0] ?? '';
  const last = letters.length > 1 ? (letters.at(-1) ?? '') : '';
  return `${first}${last}`.toLocaleUpperCase();
}
