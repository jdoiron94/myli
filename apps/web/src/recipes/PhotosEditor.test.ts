import { IMAGE_MAX_BYTES, VALIDATION_PROBLEM_TYPE } from '@myli/shared';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { answerPreferences } from '@/account/testing.ts';
import {
  accessibilityViolations,
  apiServer,
  describedBy,
  problemResponse,
  renderApp,
} from '@/testing.ts';
import type { Recipe, UpdateRecipeRequest } from './recipe.ts';
import { answerRecipe, answerTags, sampleImage, sampleRecipe } from './testing.ts';

const photosGroup = () => screen.getByRole('group', { name: 'Photos' });
const fileInput = () => {
  const input = photosGroup().querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  return input;
};
const button = (name: string) => screen.getByRole('button', { name });
const coverChoice = (position: number) =>
  screen.getByRole<HTMLInputElement>('radio', { name: `Cover: photo ${String(position)}` });

/** The photos shown, in order: each one's ID, and whether it's the cover. */
const shownPhotos = () =>
  [...photosGroup().querySelectorAll<HTMLElement>('[data-photo]')].map((item) => ({
    id: item.querySelector('img')?.getAttribute('src')?.split('/')[4],
    cover: within(item).getByRole<HTMLInputElement>('radio').checked,
  }));

/** What was wrong with the files picked last, each with its name: one, or a list. */
const problems = () =>
  within(photosGroup())
    .getAllByRole('alert')
    .flatMap((alert) => {
      const items = [...alert.querySelectorAll('li')];
      return (items.length > 0 ? items : [alert]).map((item) => item.textContent.trim());
    });

const photoFile = (name: string, type = 'image/jpeg', size = 1000) =>
  new File([new Uint8Array(size)], name, { type });

/**
 * Answers uploads with `answer`, given how many there have been, by default the photos `upload-1`,
 * `upload-2` and so on. Keeps the type and size of each.
 */
function answerUploads(answer?: (count: number) => Response | Promise<Response>) {
  const sent: { type: string | null; size: number }[] = [];
  apiServer.use(
    http.post('/api/v1/images', async ({ request }) => {
      sent.push({
        type: request.headers.get('content-type'),
        size: (await request.arrayBuffer()).byteLength,
      });
      const count = sent.length;
      return answer
        ? answer(count)
        : HttpResponse.json({ image: sampleImage(`upload-${String(count)}`) }, { status: 201 });
    }),
  );
  return sent;
}

/** The edit page for `recipe`. Keeps the photos each save sends. */
async function editPhotos(recipe: Recipe, answerSave?: () => Response) {
  answerPreferences();
  let stored = recipe;
  const saved: Pick<UpdateRecipeRequest, 'imageIds' | 'coverImageId'>[] = [];
  apiServer.use(
    http.get('/api/v1/recipes/:id', () => HttpResponse.json({ recipe: stored })),
    http.put('/api/v1/recipes/:id', async ({ request }) => {
      const { imageIds, coverImageId } = (await request.json()) as UpdateRecipeRequest;
      saved.push({ imageIds, coverImageId });
      if (answerSave) return answerSave();
      stored = { ...stored, images: imageIds.map(sampleImage), coverImageId };
      return HttpResponse.json({ recipe: stored });
    }),
  );
  const app = await renderApp('/recipes/recipe-bread/edit');
  await screen.findByRole('textbox', { name: 'Title' });
  return { ...app, saved };
}

/** Once the recipe's page has opened after saving, and loaded everything. */
const reopened = () => screen.findByRole('radio', { name: 'US customary' });

const withPhotos = (...ids: string[]) =>
  sampleRecipe({ images: ids.map(sampleImage), coverImageId: ids[0] ?? null });

// The editor loads every tag.
beforeEach(() => {
  answerTags();
});

describe('the photos editor', () => {
  it('uploads the photos picked, one after another, the first becoming the cover', async () => {
    const sent = answerUploads();
    const created = sampleRecipe({ id: 'recipe-new' });
    answerRecipe(created);
    answerPreferences();
    const bodies: unknown[] = [];
    apiServer.use(
      http.post('/api/v1/recipes', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ recipe: created }, { status: 201 });
      }),
    );
    const { user } = await renderApp('/recipes/new');
    await screen.findByRole('heading', { level: 1, name: 'New recipe' });
    expect(shownPhotos()).toEqual([]);

    await user.upload(fileInput(), [
      photoFile('bread.jpg'),
      photoFile('crumb.png', 'image/png', 2000),
    ]);

    await waitFor(() => {
      expect(shownPhotos()).toEqual([
        { id: 'upload-1', cover: true },
        { id: 'upload-2', cover: false },
      ]);
    });
    expect(sent).toEqual([
      { type: 'image/jpeg', size: 1000 },
      { type: 'image/png', size: 2000 },
    ]);
    expect(await accessibilityViolations()).toEqual([]);

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Weeknight Bread');
    await user.type(screen.getByRole('textbox', { name: 'Servings' }), '8');
    await user.click(button('Create recipe'));

    await reopened();
    expect(bodies).toEqual([
      expect.objectContaining({ imageIds: ['upload-1', 'upload-2'], coverImageId: 'upload-1' }),
    ]);
  });

  it('refuses files the API would, without sending them, and says why for each', async () => {
    const sent = answerUploads();
    await editPhotos(sampleRecipe());
    // What the picker offers can be overridden on most devices, so the editor checks too.
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(fileInput(), [
      photoFile('notes.txt', 'text/plain'),
      photoFile('huge.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1),
      photoFile('bread.jpg'),
    ]);

    await waitFor(() => {
      expect(shownPhotos()).toEqual([{ id: 'upload-1', cover: true }]);
    });
    expect(problems()).toEqual([
      'notes.txt: Upload a JPEG, PNG or WebP image.',
      'huge.jpg: The file is larger than 10 MB.',
    ]);
    expect(sent).toHaveLength(1);
    expect(await accessibilityViolations()).toEqual([]);
  });

  it('says why the API refused an upload, going on with the others', async () => {
    answerUploads((count) =>
      count === 1
        ? problemResponse(422, 'This image can’t be read.')
        : HttpResponse.json({ image: sampleImage('upload-2') }, { status: 201 }),
    );
    const { user } = await editPhotos(sampleRecipe());

    await user.upload(fileInput(), [photoFile('broken.jpg'), photoFile('bread.jpg')]);

    await waitFor(() => {
      expect(shownPhotos()).toEqual([{ id: 'upload-2', cover: true }]);
    });
    expect(problems()).toEqual(['broken.jpg: This image can’t be read.']);
  });

  it('stops at 20 photos', async () => {
    const sent = answerUploads();
    const { user } = await editPhotos(
      withPhotos(...Array.from({ length: 19 }, (_, index) => `photo-${String(index)}`)),
    );

    await user.upload(fileInput(), [photoFile('a.jpg'), photoFile('b.jpg'), photoFile('c.jpg')]);

    await waitFor(() => {
      expect(shownPhotos()).toHaveLength(20);
    });
    expect(sent).toHaveLength(1);
    expect(problems()).toEqual([
      'b.jpg: A recipe can have up to 20 photos.',
      'c.jpg: A recipe can have up to 20 photos.',
    ]);
    expect(button('Add photos').getAttribute('aria-disabled')).toBe('true');
  });

  it('orders the photos, chooses the cover, and removes them, keeping the cover one of them', async () => {
    const { user, saved } = await editPhotos(withPhotos('a', 'b', 'c'));
    expect(button('Move photo 1 earlier').getAttribute('aria-disabled')).toBe('true');
    expect(button('Move photo 3 later').getAttribute('aria-disabled')).toBe('true');

    await user.click(button('Move photo 3 earlier'));
    expect(shownPhotos().map(({ id }) => id)).toEqual(['a', 'c', 'b']);
    expect(document.activeElement).toBe(button('Move photo 2 earlier'));

    await user.click(coverChoice(3));
    expect(shownPhotos()).toEqual([
      { id: 'a', cover: false },
      { id: 'c', cover: false },
      { id: 'b', cover: true },
    ]);

    // Removing the cover makes the first photo the cover.
    await user.click(button('Remove photo 3'));
    expect(shownPhotos()).toEqual([
      { id: 'a', cover: true },
      { id: 'c', cover: false },
    ]);
    expect(document.activeElement).toBe(button('Remove photo 2'));

    await user.click(button('Save changes'));
    await reopened();
    expect(saved).toEqual([{ imageIds: ['a', 'c'], coverImageId: 'a' }]);
  });

  it('leaves no cover once the last photo is removed, and focuses the button to add more', async () => {
    const { user, saved } = await editPhotos(withPhotos('a'));

    await user.click(button('Remove photo 1'));

    expect(shownPhotos()).toEqual([]);
    expect(document.activeElement).toBe(button('Add photos'));
    await user.click(button('Save changes'));
    await reopened();
    expect(saved).toEqual([{ imageIds: [], coverImageId: null }]);
  });

  it('doesn’t save while a photo is uploading, which would leave it out', async () => {
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    answerUploads(async () => {
      await finished;
      return HttpResponse.json({ image: sampleImage('upload-1') }, { status: 201 });
    });
    const { user, saved } = await editPhotos(sampleRecipe());

    await user.upload(fileInput(), photoFile('bread.jpg'));
    expect(await within(photosGroup()).findByText('Uploading photo 1 of 1…')).toBeDefined();
    await user.click(button('Save changes'));

    expect((await screen.findByText(/^Wait for the photos/)).textContent.trim()).toBe(
      'Wait for the photos to finish uploading, then save.',
    );
    expect(saved).toEqual([]);

    finish();
    await waitFor(() => {
      expect(shownPhotos()).toEqual([{ id: 'upload-1', cover: true }]);
    });
    await user.click(button('Save changes'));
    await reopened();
    expect(saved).toEqual([{ imageIds: ['upload-1'], coverImageId: 'upload-1' }]);
  });

  it('shows the API’s refusal of a photo on it, until the photos change', async () => {
    const detail = 'This photo isn’t available any more. Upload it again.';
    const { user } = await editPhotos(withPhotos('a', 'b', 'c'), () =>
      problemResponse(422, 'The request is invalid.', {
        type: VALIDATION_PROBLEM_TYPE,
        errors: [{ in: 'body', pointer: '#/imageIds/1', detail }],
      }),
    );

    await user.click(button('Save changes'));

    await waitFor(() => {
      expect(document.activeElement).toBe(coverChoice(2));
    });
    expect(describedBy(coverChoice(2))).toEqual([detail]);
    expect(describedBy(coverChoice(1))).toEqual([]);

    await user.click(button('Remove photo 2'));
    expect(shownPhotos().map(({ id }) => id)).toEqual(['a', 'c']);
    expect(describedBy(coverChoice(2))).toEqual([]);
    expect(within(photosGroup()).queryByText(detail)).toBeNull();
  });
});
