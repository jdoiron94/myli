import { describe, expect, it } from 'vitest';
import { markdownTree } from './markdown-tree.ts';

const text = (value: string) => ({ type: 'text', value });

describe('markdownTree', () => {
  it('gives numbered lists their start, each item its number, and loose lists their spread', () => {
    expect(markdownTree('3. Knead\n4. Bake\n\n- Flour\n\n- Water')).toEqual({
      type: 'root',
      children: [
        {
          type: 'list',
          ordered: true,
          start: 3,
          spread: false,
          children: [
            {
              type: 'listItem',
              spread: false,
              label: 3,
              children: [{ type: 'paragraph', children: [text('Knead')] }],
            },
            {
              type: 'listItem',
              spread: false,
              label: 4,
              children: [{ type: 'paragraph', children: [text('Bake')] }],
            },
          ],
        },
        {
          type: 'list',
          ordered: false,
          spread: true,
          children: [
            {
              type: 'listItem',
              spread: true,
              children: [{ type: 'paragraph', children: [text('Flour')] }],
            },
            {
              type: 'listItem',
              spread: true,
              children: [{ type: 'paragraph', children: [text('Water')] }],
            },
          ],
        },
      ],
    });
  });

  it('keeps how bold and italic were written, and a link’s title', () => {
    expect(markdownTree('__Mix__ _well_, [see](/recipes/a "Soft rolls")')).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'strong', marker: '_', children: [text('Mix')] },
            text(' '),
            { type: 'emphasis', marker: '_', children: [text('well')] },
            text(', '),
            { type: 'link', url: '/recipes/a', title: 'Soft rolls', children: [text('see')] },
          ],
        },
      ],
    });
  });

  it('leaves a link the renderer drops as its words, formatting and all', () => {
    expect(markdownTree('[call **now**](tel:123)')).toEqual({
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [text('call '), { type: 'strong', marker: '*', children: [text('now')] }],
        },
      ],
    });
  });
});
