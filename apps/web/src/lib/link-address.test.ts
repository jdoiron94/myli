import { describe, expect, it } from 'vitest';
import { linkAddress, linkAddressSchema } from './link-address.ts';
import { renderMarkdown } from './markdown.ts';

describe('linkAddress', () => {
  it.each([
    ['https://example.com/bread', 'https://example.com/bread'],
    ['HTTP://example.com', 'HTTP://example.com'],
    ['  example.com/bread?x=1#y ', 'https://example.com/bread?x=1#y'],
    ['www.example.co.uk', 'https://www.example.co.uk'],
    ['example.com:8080/bread', 'https://example.com:8080/bread'],
    ['/recipes/abc', '/recipes/abc'],
    ['/', '/'],
    ['sam@example.com', 'mailto:sam@example.com'],
    ['mailto:sam@example.com', 'mailto:sam@example.com'],
    ['MAILTO:sam@example.com', 'MAILTO:sam@example.com'],
  ])('takes %j as %j', (text, address) => {
    expect(linkAddress(text)).toBe(address);
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,hi',
    'vbscript:x',
    'tel:123',
    'tel:+1-555-0100',
    'file:///etc/passwd',
    '//evil.example',
    '/\\evil.example',
    'localhost',
    'localhost:3000',
    'bread',
    'two words.com',
    'mailto:',
    'mailto:sam',
    'mailto:javascript:alert(1)@example.com',
    'https://',
    'https://exa mple.com',
  ])('refuses %j', (text) => {
    expect(linkAddress(text)).toBeUndefined();
  });

  it.each(['example.com', '/recipes/abc', 'sam@example.com', 'https://example.com/a?b=c'])(
    'gives an address the renderer keeps as a link: %j',
    (text) => {
      const address = linkAddress(text) ?? '';

      expect(renderMarkdown(`[here](${address})`)).toContain(`href="${address}"`);
    },
  );
});

describe('linkAddressSchema', () => {
  it('gives the completed address', () => {
    expect(linkAddressSchema.parse(' example.com ')).toBe('https://example.com');
  });

  it.each([
    ['', 'Enter where the link goes.'],
    ['bread', 'Enter a web address or an email address.'],
  ])('explains what’s wrong with %j', (text, message) => {
    expect(linkAddressSchema.safeParse(text).error?.issues.map((issue) => issue.message)).toEqual([
      message,
    ]);
  });
});
