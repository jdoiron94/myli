import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  passwordChecklist,
  passwordProblems,
  passwordSchema,
} from './password.ts';

const LOWERCASE = 'Must contain a lowercase letter.';
const UPPERCASE = 'Must contain an uppercase letter.';
const NUMBER = 'Must contain a number.';
const SPECIAL =
  'Must contain a special character: anything but a letter or a number, a space included.';
const TOO_SHORT = 'Must be at least 15 characters.';

describe('password rules', () => {
  it('report every rule a password breaks', () => {
    const longest = `Aa1!${'x'.repeat(PASSWORD_MAX_LENGTH - 4)}`;
    const passwords = [
      'Correct horse battery 9',
      'Abcdefghijk1!xy',
      'Abcdefghijk1!x',
      longest,
      `${longest}x`,
      'CORRECT HORSE BATTERY 9',
      'correct horse battery 9',
      'Correct horse battery nine',
      'CorrectHorseBattery9',
      // Uppercase omega, lowercase sharp s, Arabic-Indic digits.
      'Ωmega straße ٣٣ x',
      'abc',
    ];

    expect(Object.fromEntries(passwords.map((p) => [p, passwordProblems(p)]))).toEqual({
      // A space counts as a special character.
      'Correct horse battery 9': [],
      'Abcdefghijk1!xy': [],
      'Abcdefghijk1!x': [TOO_SHORT],
      [longest]: [],
      [`${longest}x`]: ['Must be at most 128 characters.'],
      'CORRECT HORSE BATTERY 9': [LOWERCASE],
      'correct horse battery 9': [UPPERCASE],
      'Correct horse battery nine': [NUMBER],
      CorrectHorseBattery9: [SPECIAL],
      'Ωmega straße ٣٣ x': [],
      abc: [TOO_SHORT, UPPERCASE, NUMBER, SPECIAL],
    });
    expect(passwordSchema.safeParse('abc').success).toBe(false);
  });
});

describe('the password checklist', () => {
  it('marks each rule met or not, as the password is typed', () => {
    const unmet = (password: string) =>
      passwordChecklist(password)
        .filter(({ met }) => !met)
        .map(({ label }) => label);

    expect(passwordChecklist('')).toEqual([
      { label: 'At least 15 characters', met: false },
      { label: 'A lowercase letter', met: false },
      { label: 'An uppercase letter', met: false },
      { label: 'A number', met: false },
      {
        label: 'A special character: anything but a letter or a number, a space included',
        met: false,
      },
    ]);
    expect(unmet('Abcdefghijk1!x')).toEqual(['At least 15 characters']);
    expect(unmet('Abcdefghijk1 xy')).toEqual([]);
  });

  it('agrees with the rules the API enforces', () => {
    const passwords = [
      'Correct horse battery 9',
      'abc',
      'Abcdefghijk1!x',
      'ÄBCdéf123ßxyz!!',
      `Aa1!${'x'.repeat(PASSWORD_MAX_LENGTH)}`,
    ];
    const checklistMet = (password: string) =>
      passwordChecklist(password).every(({ met }) => met) && password.length <= PASSWORD_MAX_LENGTH;

    expect(passwords.filter((p) => checklistMet(p) !== (passwordProblems(p).length === 0))).toEqual(
      [],
    );
  });
});
