import { describe, expect, it } from 'vitest';
import { linkAddress, linkAddressSchema } from './link-address.ts';
import { renderMarkdown } from './markdown.ts';

describe('linkAddress', () => {
  it('completes a web address, a path on this site or an email address, and takes nothing else', () => {
    const texts = {
      'https://example.com/bread': 'https://example.com/bread',
      'HTTP://example.com': 'HTTP://example.com',
      '  example.com/bread?x=1#y ': 'https://example.com/bread?x=1#y',
      'www.example.co.uk': 'https://www.example.co.uk',
      'example.com:8080/bread': 'https://example.com:8080/bread',
      '/recipes/abc': '/recipes/abc',
      'sam@example.com': 'mailto:sam@example.com',
      'MAILTO:sam@example.com': 'MAILTO:sam@example.com',
      '   ': null,
      'javascript:alert(1)': null,
      'JavaScript:alert(1)': null,
      'data:text/html,hi': null,
      'vbscript:x': null,
      'tel:123': null,
      'file:///etc/passwd': null,
      '//evil.example': null,
      '/\\evil.example': null,
      'localhost:3000': null,
      bread: null,
      'two words.com': null,
      'mailto:sam': null,
      'mailto:javascript:alert(1)@example.com': null,
      'https://': null,
      'https://exa mple.com': null,
    };

    expect(
      Object.fromEntries(Object.keys(texts).map((text) => [text, linkAddress(text) ?? null])),
    ).toEqual(texts);
  });

  it('gives addresses the renderer keeps as links', () => {
    const addresses = [
      'example.com',
      '/recipes/abc',
      'sam@example.com',
      'https://example.com/a?b=c',
    ]
      .map((text) => linkAddress(text) ?? '')
      .filter((address) => !renderMarkdown(`[here](${address})`).includes(`href="${address}"`));

    expect(addresses).toEqual([]);
  });
});

describe('linkAddressSchema', () => {
  it('gives the completed address, or explains what’s wrong', () => {
    const messages = (text: string) =>
      linkAddressSchema.safeParse(text).error?.issues.map((issue) => issue.message);

    expect(linkAddressSchema.parse(' example.com ')).toBe('https://example.com');
    expect(messages('')).toEqual(['Enter where the link goes.']);
    expect(messages('bread')).toEqual(['Enter a web address or an email address.']);
  });
});
