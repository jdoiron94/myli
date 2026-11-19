import type { TextPart } from '@myli/shared';
import { type FunctionalComponent, h } from 'vue';

const MARKS = {
  removed: {
    tag: 'del',
    said: 'Removed: ',
    class: 'bg-removed text-removed-foreground line-through',
  },
  added: { tag: 'ins', said: 'Added: ', class: 'bg-added text-added-foreground underline' },
} as const;

/**
 * A text compared between two versions, as typed, whitespace included: what was taken out struck
 * through, what was put in underlined, and each said for screen readers. A render function, since a
 * template's layout would add whitespace of its own.
 */
export const DiffText: FunctionalComponent<{ parts: TextPart[] }> = ({ parts }) =>
  h(
    'span',
    { class: 'whitespace-pre-wrap break-words' },
    parts.map(({ change, text }) => {
      if (change === 'same') return text;
      const mark = MARKS[change];
      return h(mark.tag, { class: `rounded-xs ${mark.class}` }, [
        h('span', { class: 'sr-only' }, mark.said),
        text,
      ]);
    }),
  );
DiffText.props = ['parts'];
