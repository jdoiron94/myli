import { userEvent } from '@testing-library/user-event';
import { render, screen, waitFor, within } from '@testing-library/vue';
import { useForm } from 'vee-validate';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { z } from 'zod';
import { focusFirstInvalidField, formSchema } from '@/lib/forms.ts';
import { accessibilityViolations, describedBy, focusedMarkdownEditor } from '@/testing.ts';
import MarkdownField from './MarkdownField.vue';

/** A form with two markdown fields, which keeps what it submitted. */
function renderForm(values: { first?: string; second?: string } = {}) {
  const submitted = ref<{ first: string; second: string }[]>([]);
  const Form = defineComponent({
    setup() {
      const { handleSubmit, setFieldValue } = useForm({
        validationSchema: formSchema(
          z.object({
            first: z.string().trim().min(1, 'Write something.').max(40, 'Keep it short.'),
            second: z.string(),
          }),
        ),
        initialValues: { first: values.first ?? '', second: values.second ?? '' },
      });
      const form = ref<HTMLFormElement | null>(null);
      const submit = handleSubmit(
        (valid) => {
          submitted.value.push(valid);
        },
        () => {
          focusFirstInvalidField(form.value);
        },
      );
      return () =>
        h('form', { ref: form, onSubmit: submit, novalidate: true }, [
          h(MarkdownField, { name: 'first', label: 'First', description: 'A hint.' }),
          h(MarkdownField, { name: 'second', label: 'Second' }),
          h('button', { type: 'submit' }, 'Submit'),
          h(
            'button',
            {
              type: 'button',
              onClick: () => {
                setFieldValue('first', 'Started *again*');
              },
            },
            'Start again',
          ),
        ]);
    },
  });
  const user = userEvent.setup();
  render(Form);
  return { user, submitted };
}

const textbox = (name: string) => screen.getByRole('textbox', { name });
const toolbar = () => screen.getByRole('toolbar', { name: 'Formatting' });
const tool = (name: string) => within(toolbar()).getByRole('button', { name });
const submit = () => screen.getByRole('button', { name: 'Submit' });
// Rules about a whole page: this form is only a part of one.
const PAGE_RULES = ['document-title', 'html-has-lang', 'region'];

describe('MarkdownField', () => {
  it('shows the markdown rendered, as the recipe will, until it’s focused', async () => {
    renderForm({ second: 'A **bold** start.\n\n- [One](/recipes/one)' });

    const second = textbox('Second');
    expect(second.getAttribute('contenteditable')).toBeNull();
    expect(second.getAttribute('tabindex')).toBe('0');
    expect(second.getAttribute('aria-multiline')).toBe('true');
    expect(within(second).getByText('bold').tagName).toBe('STRONG');
    // Its link is part of the text, not a place to go.
    const link = within(second).getByRole('link', { name: 'One' });
    expect(link.tabIndex).toBe(-1);
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(await accessibilityViolations({ skip: PAGE_RULES })).toEqual([]);
  });

  it('opens the editor in its place when focused, with the cursor at the end', async () => {
    const { user, submitted } = renderForm({ second: 'Mix **well**.' });

    await user.tab();
    await user.tab();
    const second = await focusedMarkdownEditor('Second');

    expect(toolbar()).toBeDefined();
    await user.keyboard(' Then rest.');
    expect(within(second).getByText('well').tagName).toBe('STRONG');
    await user.click(textbox('First'));
    await focusedMarkdownEditor('First');
    await user.keyboard('Bread');
    await user.click(submit());

    await waitFor(() => {
      expect(submitted.value).toEqual([{ first: 'Bread', second: 'Mix **well**. Then rest.' }]);
    });
  });

  it('opens the editor when the rendered markdown is clicked, even on a link', async () => {
    const { user } = renderForm({ second: '[One](/recipes/one)' });

    const clicks: MouseEvent[] = [];
    document.addEventListener('click', (event) => clicks.push(event), { once: true });

    await user.click(within(textbox('Second')).getByRole('link', { name: 'One' }));

    expect(clicks.map((click) => click.defaultPrevented)).toEqual([true]);
    await focusedMarkdownEditor('Second');
    await user.click(screen.getByText('First'));
    await focusedMarkdownEditor('First');
  });

  it('keeps one editor open at a time, showing the others rendered', async () => {
    const { user } = renderForm();

    await user.click(textbox('First'));
    await focusedMarkdownEditor('First');
    await user.keyboard('Some **bold** ');
    await user.click(textbox('Second'));
    await focusedMarkdownEditor('Second');

    const first = textbox('First');
    expect(first.getAttribute('contenteditable')).toBeNull();
    expect(within(first).getByText('bold').tagName).toBe('STRONG');
    expect(screen.getAllByRole('toolbar')).toHaveLength(1);
    expect(document.querySelectorAll('[contenteditable]')).toHaveLength(1);
  });

  it('shows a value changed from outside while it’s open', async () => {
    const { user } = renderForm({ first: 'Old' });
    await user.click(textbox('First'));
    const first = await focusedMarkdownEditor('First');

    await user.click(screen.getByRole('button', { name: 'Start again' }));

    await waitFor(() => {
      expect(within(first).getByText('again').tagName).toBe('EM');
    });
    expect(first.textContent).toBe('Started again');
  });

  it('leaves focus where it went while the editor was opening', async () => {
    renderForm();

    textbox('First').focus();
    submit().focus();

    await waitFor(() => {
      expect(textbox('First').getAttribute('contenteditable')).toBe('true');
    });
    expect(document.activeElement).toBe(submit());
  });

  it('explains a problem at the field, focuses it, and checks it again as it’s typed in', async () => {
    const { user, submitted } = renderForm();

    await user.click(submit());

    const first = await focusedMarkdownEditor('First');
    expect(first.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(first)).toEqual(['Write something.', 'A hint.']);
    expect(await accessibilityViolations({ skip: PAGE_RULES })).toEqual([]);

    await user.keyboard('Bread');
    await waitFor(() => {
      expect(first.getAttribute('aria-invalid')).toBeNull();
    });
    expect(describedBy(first)).toEqual(['A hint.']);
    await user.click(submit());
    await waitFor(() => {
      expect(submitted.value).toEqual([{ first: 'Bread', second: '' }]);
    });
  });

  it('shows the problem on the rendered markdown while it isn’t being edited', async () => {
    const { user } = renderForm({ first: 'Far more than forty characters, which is the limit' });

    await user.click(textbox('Second'));
    await focusedMarkdownEditor('Second');
    await user.click(submit());

    await waitFor(() => {
      expect(textbox('First').getAttribute('aria-invalid')).toBe('true');
    });
    expect(describedBy(textbox('First'))).toEqual(['Keep it short.', 'A hint.']);
    await focusedMarkdownEditor('First');
  });

  describe('its toolbar', () => {
    it('formats what’s selected, says what’s on, and goes back to writing', async () => {
      const { user, submitted } = renderForm();
      await user.click(textbox('First'));
      const first = await focusedMarkdownEditor('First');
      await user.keyboard('Knead');
      await user.keyboard('{Control>}a{/Control}');

      await user.click(tool('Bold'));

      expect(tool('Bold').getAttribute('aria-pressed')).toBe('true');
      expect(tool('Italic').getAttribute('aria-pressed')).toBe('false');
      expect(document.activeElement).toBe(first);
      await user.click(tool('Italic'));
      await user.click(tool('Bulleted list'));
      expect(tool('Bulleted list').getAttribute('aria-pressed')).toBe('true');
      await user.click(tool('Numbered list'));
      expect(tool('Bulleted list').getAttribute('aria-pressed')).toBe('false');
      expect(tool('Numbered list').getAttribute('aria-pressed')).toBe('true');
      await user.click(submit());

      await waitFor(() => {
        expect(submitted.value).toEqual([{ first: '1. ***Knead***', second: '' }]);
      });
      expect(await accessibilityViolations({ skip: PAGE_RULES })).toEqual([]);
    });

    it('makes the selection code', async () => {
      const { user, submitted } = renderForm();
      await user.click(textbox('First'));
      await focusedMarkdownEditor('First');
      await user.keyboard('200 C');
      await user.keyboard('{Control>}a{/Control}');

      await user.click(tool('Code'));

      expect(tool('Code').getAttribute('aria-pressed')).toBe('true');
      await user.click(submit());
      await waitFor(() => {
        expect(submitted.value).toEqual([{ first: '`200 C`', second: '' }]);
      });
    });

    it('is one stop for Tab, moved through with the arrow keys', async () => {
      const { user } = renderForm();
      await user.click(textbox('First'));
      await focusedMarkdownEditor('First');

      await user.tab({ shift: true });
      expect(document.activeElement).toBe(tool('Bold'));
      await user.keyboard('{ArrowRight}{ArrowRight}');
      expect(document.activeElement).toBe(tool('Code'));
      await user.tab();
      await focusedMarkdownEditor('First');
    });

    it('goes back to writing after a button is pressed from the keyboard', async () => {
      const { user, submitted } = renderForm();
      await user.click(textbox('First'));
      await focusedMarkdownEditor('First');

      await user.tab({ shift: true });
      await user.keyboard('{Enter}');
      await focusedMarkdownEditor('First');
      await user.keyboard('Knead');

      expect(tool('Bold').getAttribute('aria-pressed')).toBe('true');
      await user.click(submit());
      await waitFor(() => {
        expect(submitted.value).toEqual([{ first: '**Knead**', second: '' }]);
      });
    });
  });

  describe('links', () => {
    /** Opens the editor on First with `text` typed and selected. */
    async function selected(text: string) {
      const app = renderForm();
      await app.user.click(textbox('First'));
      const first = await focusedMarkdownEditor('First');
      await app.user.keyboard(text);
      await app.user.keyboard('{Control>}a{/Control}');
      return { ...app, first };
    }
    const dialog = () => screen.getByRole('dialog');
    const address = () => within(dialog()).getByRole('textbox', { name: 'Address' });

    it('links what’s selected, then goes back to the editor', async () => {
      const { user, submitted, first } = await selected('Rolls');

      await user.click(tool('Link'));

      expect(within(dialog()).getByRole('heading', { name: 'Add a link' })).toBeDefined();
      expect(document.activeElement).toBe(address());
      expect(within(dialog()).queryByRole('textbox', { name: 'Text' })).toBeNull();
      expect(within(dialog()).queryByRole('button', { name: 'Remove link' })).toBeNull();
      expect(await accessibilityViolations({ skip: PAGE_RULES })).toEqual([]);
      await user.type(address(), 'example.com/rolls{Enter}');

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(document.activeElement).toBe(first);
      expect(tool('Link').getAttribute('aria-pressed')).toBe('true');
      await user.click(submit());
      await waitFor(() => {
        expect(submitted.value).toEqual([
          { first: '[Rolls](https://example.com/rolls)', second: '' },
        ]);
      });
    });

    it('explains an address it can’t link to', async () => {
      const { user } = await selected('Rolls');
      await user.click(tool('Link'));

      await user.type(address(), 'javascript:alert(1)');
      await user.click(within(dialog()).getByRole('button', { name: 'Save link' }));

      await waitFor(() => {
        expect(document.activeElement).toBe(address());
      });
      expect(address().getAttribute('aria-invalid')).toBe('true');
      expect(describedBy(address())).toEqual([
        'Enter a web address or an email address.',
        'Like example.com/bread, or sam@example.com.',
      ]);
    });

    it('changes or removes the link the cursor is in', async () => {
      const { user, submitted, first } = await selected('Rolls');
      await user.click(tool('Link'));
      await user.type(address(), '/recipes/rolls{Enter}');
      await waitFor(() => {
        expect(document.activeElement).toBe(first);
      });

      await user.keyboard('{ArrowLeft}{ArrowLeft}');
      await user.keyboard('{Control>}k{/Control}');

      expect(within(dialog()).getByRole('heading', { name: 'Change the link' })).toBeDefined();
      expect(address()).toHaveProperty('value', '/recipes/rolls');
      await user.click(within(dialog()).getByRole('button', { name: 'Remove link' }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(document.activeElement).toBe(first);
      expect(tool('Link').getAttribute('aria-pressed')).toBe('false');
      await user.click(submit());
      await waitFor(() => {
        expect(submitted.value).toEqual([{ first: 'Rolls', second: '' }]);
      });
    });

    it('asks for the words to show when nothing is selected', async () => {
      const { user, submitted } = renderForm();
      await user.click(textbox('First'));
      await focusedMarkdownEditor('First');
      await user.keyboard('See ');

      await user.click(tool('Link'));
      await user.type(address(), 'sam@example.com');
      await user.type(within(dialog()).getByRole('textbox', { name: 'Text' }), 'Sam');
      await user.click(within(dialog()).getByRole('button', { name: 'Save link' }));
      await focusedMarkdownEditor('First');
      await user.keyboard('.');

      await user.click(submit());
      await waitFor(() => {
        expect(submitted.value).toEqual([
          { first: 'See [Sam](mailto:sam@example.com).', second: '' },
        ]);
      });
    });

    it('goes back to the editor when opened from the toolbar with the keyboard', async () => {
      const { user, first } = await selected('Rolls');
      await user.tab({ shift: true });
      await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
      expect(document.activeElement).toBe(tool('Link'));

      await user.keyboard('{Enter}');
      await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(document.activeElement).toBe(first);
    });

    it('leaves the text as it was when cancelled', async () => {
      const { user, first } = await selected('Rolls');
      await user.click(tool('Link'));
      await user.type(address(), 'example.com');

      await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(document.activeElement).toBe(first);
      expect(within(first).queryByRole('link')).toBeNull();
    });
  });
});
