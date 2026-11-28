import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, initials } from './avatars.ts';

/** WCAG 2's relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

describe('avatars', () => {
  it('colors every circle dark enough for white initials (WCAG AA)', () => {
    const contrast = (hex: string) => (1 + 0.05) / (luminance(hex) + 0.05);
    const tooLight = AVATAR_COLORS.filter((hex) => contrast(hex) < 4.5);

    expect(tooLight).toEqual([]);
  });

  it('takes the first letters of the first and last words that have one', () => {
    const names = [
      'Ada Lovelace',
      'Grace',
      '  grace   brewster murray hopper ',
      'Ada “the cook” Lovelace',
      'Ana-María López',
      'Émile Zola',
      '李小龙',
      '🍞 Baker',
      '🍞',
      'R2 D2',
    ];

    expect(Object.fromEntries(names.map((name) => [name, initials(name)]))).toEqual({
      'Ada Lovelace': 'AL',
      Grace: 'G',
      '  grace   brewster murray hopper ': 'GH',
      'Ada “the cook” Lovelace': 'AL',
      'Ana-María López': 'AL',
      'Émile Zola': 'ÉZ',
      李小龙: '李',
      '🍞 Baker': 'B',
      '🍞': '',
      'R2 D2': 'RD',
    });
  });
});
