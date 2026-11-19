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
});
