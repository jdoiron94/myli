import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
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
  it('are 15 to 128 characters', () => {
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toEqual([15, 128]);
  });

  it.each(['Correct horse battery 9', 'Tr0ub4dor&3-and-more', 'ABCdef123!@#xyz'])(
    'accept %j',
    (password) => {
      expect(passwordProblems(password)).toEqual([]);
      expect(passwordSchema.parse(password)).toBe(password);
    },
  );

  it('accept exactly 15 characters, and reject 14', () => {
    expect(passwordProblems('Abcdefghijk1!xy')).toEqual([]);
    expect(passwordProblems('Abcdefghijk1!x')).toEqual([TOO_SHORT]);
  });

  it(`reject more than ${String(PASSWORD_MAX_LENGTH)} characters`, () => {
    const longest = `Aa1!${'x'.repeat(PASSWORD_MAX_LENGTH - 4)}`;
    expect(passwordProblems(longest)).toEqual([]);
    expect(passwordProblems(`${longest}x`)).toEqual(['Must be at most 128 characters.']);
  });

  it.each([
    ['CORRECT HORSE BATTERY 9', LOWERCASE],
    ['correct horse battery 9', UPPERCASE],
    ['Correct horse battery nine', NUMBER],
    ['CorrectHorseBattery9', SPECIAL],
  ])('report exactly the one rule %j breaks', (password, problem) => {
    expect(passwordProblems(password)).toEqual([problem]);
  });

  it('count a space as a special character', () => {
    expect(passwordProblems('Correct horse battery 9')).toEqual([]);
  });

  it('count letters and numbers from any script', () => {
    // Uppercase omega, lowercase sharp s, Arabic-Indic digits, and spaces as the special character.
    expect(passwordProblems('Ωmega straße ٣٣ x')).toEqual([]);
  });

  it('list every broken rule at once', () => {
    expect(passwordProblems('abc')).toEqual([TOO_SHORT, UPPERCASE, NUMBER, SPECIAL]);
  });
});

describe('the password checklist', () => {
  const unmet = (password: string) =>
    passwordChecklist(password)
      .filter(({ met }) => !met)
      .map(({ label }) => label);

  it('lists every rule, all unmet for an empty password', () => {
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
  });

  it.each([
    [
      'abc',
      [
        'At least 15 characters',
        'An uppercase letter',
        'A number',
        'A special character: anything but a letter or a number, a space included',
      ],
    ],
    ['Abcdefghijk1!x', ['At least 15 characters']],
    ['Abcdefghijk1 xy', []],
  ])('marks what %j still needs', (password, needed) => {
    expect(unmet(password)).toEqual(needed);
  });

  it.each([
    'Correct horse battery 9',
    'abc',
    'Abcdefghijk1!x',
    'ÄBCdéf123ßxyz!!',
    `Aa1!${'x'.repeat(PASSWORD_MAX_LENGTH)}`,
  ])('agrees with the rules the API enforces, for %j', (password) => {
    const allMet = passwordChecklist(password).every(({ met }) => met);
    const tooLong = password.length > PASSWORD_MAX_LENGTH;
    expect(allMet && !tooLong).toBe(passwordProblems(password).length === 0);
  });
});
