import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import MarkdownContent from './MarkdownContent.vue';

describe('MarkdownContent', () => {
  it('renders the markdown', async () => {
    const view = render(MarkdownContent, { props: { source: 'Preheat the **oven**.' } });
    expect(screen.getByText('oven').tagName).toBe('STRONG');

    await view.rerender({ source: 'Preheat the _oven_.' });
    expect(screen.getByText('oven').tagName).toBe('EM');
  });

  it('takes classes from where it’s used, for spacing', () => {
    render(MarkdownContent, { props: { source: 'Rest the dough.' }, attrs: { class: 'mt-4' } });
    expect(screen.getByText('Rest the dough.').parentElement?.className).toBe('markdown mt-4');
  });

  it('never renders what was typed as HTML', () => {
    render(MarkdownContent, { props: { source: '<img src=x onerror="steal()">' } });
    expect(screen.getByText('<img src=x onerror="steal()">')).toBeDefined();
    expect(document.querySelector('img')).toBeNull();
  });
});
