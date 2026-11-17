import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import MarkdownContent from './MarkdownContent.vue';

describe('MarkdownContent', () => {
  it('renders the markdown, with headings below the section it’s in', async () => {
    const view = render(MarkdownContent, {
      props: { source: '# Before you start\nPreheat the **oven**.' },
    });

    expect(screen.getByRole('heading', { level: 3, name: 'Before you start' })).toBeDefined();
    expect(screen.getByText('oven').tagName).toBe('STRONG');

    await view.rerender({ source: '# Before you start', headingLevel: 2 });
    expect(screen.getByRole('heading', { level: 2, name: 'Before you start' })).toBeDefined();
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
