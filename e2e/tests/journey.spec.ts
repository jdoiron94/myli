import type { Locator, Page } from '@playwright/test';
import { checkPage } from './accessibility.ts';
import { expect, test } from './fixtures.ts';
import { solidPng } from './images.ts';

const ADMIN = {
  name: 'Grace Hopper',
  email: 'grace@example.com',
  password: 'Correct horse 1 battery!',
};
const MEMBER = {
  name: 'Katherine Johnson',
  email: 'katherine@example.com',
  password: 'Staple battery 2 horse!',
};

// The tests after the first sign in with the admin it set up, and go on with the recipe the one
// before wrote, so each needs the one before. Each goes through several pages and checks each with
// axe in both themes, which takes Chromium up to about 25 seconds here. A minute leaves room for a
// slower machine, like CI's runners; a test that takes much longer here is split.
test.describe.configure({ mode: 'serial', timeout: 60_000 });

/** Where the recipe the journey writes lives, once it's written. */
let recipePath = '';

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
// `exact`, so "Show password" doesn't match too.
const passwordField = (page: Page) => page.getByLabel('Password', { exact: true });

/** Waits for a photo to load, from the API: scrolled to, since photos load once they're near. */
async function loaded(photo: Locator) {
  await photo.scrollIntoViewIfNeeded();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
}

/** Whether a photo that loaded is taller than it's wide, as the file it came from was. */
const portrait = (photo: Locator) =>
  photo.evaluate((img: HTMLImageElement) => img.naturalHeight > img.naturalWidth);

const adminMenuButton = (page: Page) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Admin' });

/** Opens an admin page from the header's Admin menu. */
async function openAdminPage(page: Page, name: string) {
  await adminMenuButton(page).click();
  await page.getByRole('menuitem', { name }).click();
}

async function signIn(page: Page, { email, password }: { email: string; password: string }) {
  await expect(heading(page, 'Sign in')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(email);
  await passwordField(page).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Signs in the admin the first test set up, from the sign-in page, as each test after it starts. */
async function signInAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(ADMIN.email);
  await signIn(page, ADMIN);
  await expect(heading(page, 'Recipes')).toBeVisible();
}

/** The recipe the journey writes, as home lists it. */
const listedRecipe = (page: Page) =>
  page.getByRole('list', { name: 'Recipes' }).getByRole('link', { name: 'Weeknight Bread' });

test('an admin sets up myli, invites someone and manages their account', async ({
  page,
  newContext,
  baseURL,
  clientAddress,
  searchAvailable,
}) => {
  test.setTimeout(180_000);

  await test.step('first-run setup creates the first admin', async () => {
    await page.goto('/');

    await expect(heading(page, 'Set up myli')).toBeVisible();
    await expect(page).toHaveURL('/setup');
    await checkPage(page);
    await page.getByRole('textbox', { name: 'Name' }).fill(ADMIN.name);
    await page.getByRole('textbox', { name: 'Email' }).fill(ADMIN.email);
    await passwordField(page).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Create admin account' }).click();

    // Setup doesn't sign them in: the sign-in page has their email ready.
    await expect(heading(page, 'Sign in')).toBeVisible();
    await checkPage(page);
  });

  await test.step('the admin signs in', async () => {
    await signIn(page, ADMIN);

    await expect(heading(page, 'Recipes')).toBeVisible();
    await checkPage(page);
    await page.getByRole('button', { name: `Account: ${ADMIN.name}` }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await checkPage(page, { popup: true });
    await page.keyboard.press('Escape');
  });

  await test.step('the audit log records the address they signed in from', async () => {
    const response = await page.request.get('/api/v1/audit-events?action=sign_in.succeeded');

    expect(response.status()).toBe(200);
    const { events } = (await response.json()) as { events: { ip: string | null }[] };
    expect(events.map(({ ip }) => ip)).toEqual([clientAddress]);
  });

  let link = '';
  await test.step('the admin invites someone as an admin, and gets the link to share', async () => {
    await adminMenuButton(page).click();
    await expect(page.getByRole('menuitem', { name: 'Invitations' })).toBeVisible();
    await checkPage(page, { popup: true });
    await page.getByRole('menuitem', { name: 'Invitations' }).click();
    await expect(heading(page, 'Invitations')).toBeVisible();
    await expect(heading(page, 'Invitations')).toBeFocused();
    await expect(page.getByText('No open invitations.')).toBeVisible();
    await checkPage(page);

    await page.getByRole('textbox', { name: 'Email' }).fill(MEMBER.email);
    await page.getByRole('radio', { name: 'Admin' }).check();
    await page.getByRole('button', { name: 'Invite' }).click();

    // Without SMTP, the link is shown once.
    const linkField = page.getByRole('textbox', { name: 'Invitation link' });
    await expect(linkField).toBeFocused();
    link = await linkField.inputValue();
    expect(link).toMatch(new RegExp(`^${baseURL ?? ''}/accept-invitation#.+`));
    await expect(page.getByRole('table', { name: 'Open invitations' })).toContainText(MEMBER.email);
    await checkPage(page);

    // Revoking asks first. They change their mind.
    await page.getByRole('button', { name: `Revoke invitation for ${MEMBER.email}` }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await checkPage(page, { popup: true });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
  });

  // Someone else, in their own browser.
  const member = await (await newContext({ baseURL, viewport: page.viewportSize() })).newPage();

  await test.step('they accept the invitation and sign in', async () => {
    await member.goto(link);

    await expect(heading(member, 'Accept invitation')).toBeVisible();
    // The token leaves the address as soon as the page has read it.
    await expect(member).toHaveURL('/accept-invitation');
    await expect(member.getByRole('textbox', { name: 'Email' })).toHaveValue(MEMBER.email);
    await checkPage(member);
    await member.getByRole('textbox', { name: 'Name' }).fill(MEMBER.name);
    await passwordField(member).fill(MEMBER.password);
    await member.getByRole('button', { name: 'Create account' }).click();

    await signIn(member, MEMBER);
    await expect(heading(member, 'Recipes')).toBeVisible();
  });

  await test.step('the admin sees them on the Users page', async () => {
    await openAdminPage(page, 'Users');

    await expect(heading(page, 'Users')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Users' })).toContainText(MEMBER.email);
    await checkPage(page);
  });

  await test.step('deactivating them signs them out everywhere', async () => {
    // They're on the Users page too, as an admin.
    await openAdminPage(member, 'Users');
    await expect(member.getByRole('table', { name: 'Users' })).toBeVisible();

    await page.getByRole('button', { name: `Deactivate ${MEMBER.name}` }).click();
    await expect(page.getByRole('alertdialog')).toContainText("They're signed out everywhere");
    await checkPage(page, { popup: true });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Deactivated' })).toHaveText(
      `Deactivated ${MEMBER.name}. They've been signed out.`,
    );
    await expect(page.getByRole('button', { name: `Reactivate ${MEMBER.name}` })).toBeFocused();

    // Their next request finds out, and their sign-in is refused.
    await member.getByRole('button', { name: `Change role for ${ADMIN.name}` }).click();
    await member.getByRole('radio', { name: 'Viewer' }).check();
    await member.getByRole('button', { name: 'Save' }).click();
    await expect(heading(member, 'Sign in')).toBeVisible();
    await expect(
      member.getByText("You've been signed out. Sign in again to continue."),
    ).toBeVisible();
    await checkPage(member);
    await signIn(member, MEMBER);
    await expect(member.getByRole('alert')).toHaveText(
      'This account is deactivated. Ask an admin to reactivate it.',
    );
  });

  await test.step('reactivating them lets them sign in again, back where they were', async () => {
    await page.getByRole('button', { name: `Reactivate ${MEMBER.name}` }).click();
    await expect(page.getByRole('button', { name: `Deactivate ${MEMBER.name}` })).toBeFocused();

    await member.getByRole('button', { name: 'Sign in' }).click();

    await expect(heading(member, 'Users')).toBeVisible();
    await expect(member).toHaveURL('/admin/users');
  });

  await test.step('a role change reaches a page they already have open', async () => {
    await page.getByRole('button', { name: `Change role for ${MEMBER.name}` }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkPage(page, { popup: true });
    await page.getByRole('radio', { name: 'Editor' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'is now' })).toHaveText(
      `${MEMBER.name} is now an editor.`,
    );

    // Their page still shows the admin controls, until the API refuses one.
    await member.getByRole('button', { name: `Change role for ${ADMIN.name}` }).click();
    await member.getByRole('radio', { name: 'Viewer' }).check();
    await member.getByRole('button', { name: 'Save' }).click();

    await expect(heading(member, "You don't have access to this page")).toBeVisible();
    await expect(member).toHaveURL('/admin/users');
    // An editor's header links to search, their favorites and collections and a new recipe, with
    // no Admin menu.
    await expect(member.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([
      'Search',
      'Favorites',
      'Collections',
      'New recipe',
    ]);
    await expect(adminMenuButton(member)).toHaveCount(0);
    await checkPage(member);
  });

  await test.step('the admin rebuilds the search index', async () => {
    await openAdminPage(page, 'Search index');
    await expect(heading(page, 'Search index')).toBeVisible();
    const status = page.getByRole('status');
    await expect(status).toContainText(
      searchAvailable ? 'Search is working.' : 'Search is unavailable right now.',
    );
    await checkPage(page);

    await page.getByRole('button', { name: 'Rebuild index' }).click();

    // With Meilisearch, the rebuild finishes. Without it, it waits for search to come back.
    await expect(status).toContainText(
      searchAvailable ? /The last rebuild, asked for .+, finished\./ : /is waiting for search/,
      { timeout: 30_000 },
    );
  });

  await test.step('the admin signs out', async () => {
    await page.getByRole('button', { name: `Account: ${ADMIN.name}` }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(heading(page, 'Sign in')).toBeVisible();
  });
});

test('an admin writes a recipe, with a formatted description, steps and tags, and shares it', async ({
  page,
}) => {
  await signInAsAdmin(page);

  await test.step('the description is edited in place, with its toolbar', async () => {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'New recipe' })
      .click();
    await expect(heading(page, 'New recipe')).toBeVisible();
    await page.getByRole('textbox', { name: 'Title' }).fill('Weeknight Bread');
    await page.getByRole('textbox', { name: 'Servings' }).fill('8');
    await page.getByRole('textbox', { name: 'Ingredient 1' }).fill('500 g bread flour');

    const description = page.getByRole('textbox', { name: 'Description' });
    await description.click();
    await expect(description).toHaveAttribute('contenteditable', 'true');
    await expect(description).toBeFocused();
    await page.keyboard.type('A crusty ');
    // Bold on while typing a word, then off again.
    const bold = page.getByRole('button', { name: 'Bold' });
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await expect(description).toBeFocused();
    await page.keyboard.type('loaf');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.type(', from ');
    await checkPage(page);
  });

  await test.step('a link is added from its dialog', async () => {
    await page.getByRole('button', { name: 'Link' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a link' });
    await expect(dialog).toBeVisible();
    await checkPage(page, { popup: true });
    await dialog.getByRole('textbox', { name: 'Address' }).fill('example.com/bread');
    await dialog.getByRole('textbox', { name: 'Text' }).fill('the original');
    await dialog.getByRole('button', { name: 'Save link' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Description' })).toBeFocused();
    await page.keyboard.type('.');
  });

  await test.step('steps are written one at a time, and put in order', async () => {
    const step = (position: number) =>
      page.getByRole('textbox', { name: `Step ${String(position)}` });
    /** Waits for the step's editor, which takes the rendered markdown's place, to have focus. */
    const writing = async (position: number) => {
      await expect(step(position)).toHaveAttribute('contenteditable', 'true');
      await expect(step(position)).toBeFocused();
    };
    await step(1).click();
    await writing(1);
    await page.keyboard.type('Bake at 400°F.');
    await page.getByRole('button', { name: 'Add a step', exact: true }).click();
    await writing(2);
    await page.keyboard.type('Mix everything.');
    await page.getByRole('button', { name: 'Move step 2 up' }).click();
    await expect(page.getByRole('button', { name: 'Move step 1 up' })).toBeFocused();
    await expect(step(1)).toHaveText('Mix everything.');
    await expect(step(2)).toHaveText('Bake at 400°F.');

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add a photo to step 2' }).click();
    await (await chooser).setFiles({
      name: 'oven.png',
      mimeType: 'image/png',
      buffer: solidPng(1200, 900, [90, 60, 40]),
    });
    await expect(page.getByRole('button', { name: 'Remove photo from step 2' })).toBeVisible();
    await loaded(page.getByRole('list', { name: 'Steps' }).locator('img'));
    await page
      .getByRole('textbox', { name: 'Alt text for step 2’s photo' })
      .fill('The loaf going into the oven.');
    await checkPage(page);
  });

  await test.step('photos are uploaded from the device, and the cover chosen', async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add photos' }).click();
    await (await chooser).setFiles([
      { name: 'loaf.png', mimeType: 'image/png', buffer: solidPng(1600, 1200, [194, 120, 74]) },
      { name: 'crumb.png', mimeType: 'image/png', buffer: solidPng(1200, 1600, [240, 220, 180]) },
    ]);

    const photos = page.getByRole('group', { name: 'Photos' }).locator('img');
    await expect(photos).toHaveCount(2);
    await expect(page.getByRole('radio', { name: 'Cover: photo 1' })).toBeChecked();
    for (const photo of await photos.all()) await loaded(photo);
    await page.getByRole('radio', { name: 'Cover: photo 2' }).check();
    await page
      .getByRole('textbox', { name: 'Alt text for photo 2' })
      .fill('The loaf cut open, showing its crumb.');
    await checkPage(page);
  });

  await test.step('tags are checked, and a new one added', async () => {
    await page.getByRole('checkbox', { name: 'wheat' }).check();
    await page.getByRole('textbox', { name: 'New cuisine' }).fill('American');
    await page.getByRole('button', { name: 'Add cuisine' }).click();
    const american = page.getByRole('checkbox', { name: 'American' });
    await expect(american).toBeChecked();
    await expect(american).toBeFocused();
    await checkPage(page);
  });

  await test.step('the recipe shows what was written, as it was written', async () => {
    await page.getByRole('button', { name: 'Create recipe' }).click();

    await expect(heading(page, 'Weeknight Bread')).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByText('loaf', { exact: true })).toHaveJSProperty('tagName', 'STRONG');
    await expect(main.getByRole('link', { name: 'the original' })).toHaveAttribute(
      'href',
      'https://example.com/bread',
    );
    await expect(page.getByRole('region', { name: 'Steps' }).getByRole('listitem')).toHaveText([
      'Mix everything.',
      'Bake at 400°F.',
    ]);
    await expect(main.getByRole('list', { name: 'Tags' }).getByRole('listitem')).toHaveText([
      'Contains wheat',
      'American',
    ]);
    // The cover chosen, the upright one, first in a slideshow at the top, then the other photo;
    // the step's in its step.
    const photos = main.locator('img');
    await expect(photos).toHaveCount(3);
    const stepPhoto = page
      .getByRole('region', { name: 'Steps' })
      .getByRole('listitem')
      .nth(1)
      .locator('img');
    await loaded(stepPhoto);
    const slideshow = main.getByRole('region', { name: 'Photos' });
    const cover = slideshow.getByRole('group', { name: '1 of 2' }).locator('img');
    const other = slideshow.getByRole('group', { name: '2 of 2' }).locator('img');
    const showing = slideshow.getByText(/of 2$/);
    await loaded(cover);
    await expect(showing).toHaveText('Photo 1 of 2');
    await expect(other).not.toBeInViewport();
    // The next photo slides in, and focus stays on the button at the end.
    const next = slideshow.getByRole('button', { name: 'Next photo' });
    await next.click();
    await expect(other).toBeInViewport({ ratio: 0.99 });
    await expect(cover).not.toBeInViewport();
    await expect(showing).toHaveText('Photo 2 of 2');
    await expect(next).toHaveAttribute('aria-disabled', 'true');
    await expect(next).toBeFocused();
    await loaded(other);
    expect([await portrait(cover), await portrait(other)]).toEqual([true, false]);
    // And back with the arrow keys.
    await page.keyboard.press('ArrowLeft');
    await expect(cover).toBeInViewport({ ratio: 0.99 });
    await expect(showing).toHaveText('Photo 1 of 2');
    // Each with the alt text typed for it, the other photo without any.
    await expect(cover).toHaveAttribute('alt', 'The loaf cut open, showing its crumb.');
    await expect(stepPhoto).toHaveAttribute('alt', 'The loaf going into the oven.');
    await expect(other).toHaveAttribute('alt', '');
    await checkPage(page);
  });

  await test.step('the recipe is shared once asked', async () => {
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Share with everyone' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Share “Weeknight Bread”?' });
    await expect(dialog).toBeVisible();
    await checkPage(page, { popup: true });
    await dialog.getByRole('button', { name: 'Share' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Shared' })).toHaveText(
      'Shared: everyone on myli can see it now.',
    );
    await expect(page.getByText('Private', { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Make private' })).toBeFocused();
  });

  recipePath = new URL(page.url()).pathname;
});

test('the recipe is found from home and search, rated, kept, collected, commented on and noted, cooked from and printed', async ({
  page,
  searchAvailable,
}) => {
  // The markdown editor's module, which only someone who comments should load on this page.
  const editorRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('MarkdownEditor')) editorRequests.push(request.url());
  });
  await signInAsAdmin(page);
  const listed = listedRecipe(page);

  await test.step('home lists it, from the database, with or without search', async () => {
    await page.getByRole('link', { name: 'myli', exact: true }).click();
    await expect(heading(page, 'Recipes')).toBeVisible();
    await expect(listed).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'recipe' })).toHaveText('1 recipe');
    // Its card shows its cover, the upright one.
    const cover = page.getByRole('article').locator('img');
    await loaded(cover);
    expect(await portrait(cover)).toBe(true);
    await checkPage(page);
  });

  await test.step('search, from the header, finds it by its description, and filters it out', async () => {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Search' })
      .click();
    await expect(heading(page, 'Search')).toBeVisible();
    await expect(page).toHaveURL(/\/search$/);
    if (!searchAvailable) {
      // The dev servers run without Meilisearch: search says so, after its retries.
      await expect(page.getByRole('alert')).toHaveText(/^Search is unavailable right now\./, {
        timeout: 15_000,
      });
      await page.goBack();
      await listed.click();
      await expect(heading(page, 'Weeknight Bread')).toBeVisible();
      return;
    }

    const searchbox = page.getByRole('searchbox', { name: 'Search recipes' });
    await searchbox.fill('crusty');
    await searchbox.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=crusty$/);
    await expect(searchbox).toBeFocused();
    const result = page.getByRole('list', { name: 'Recipes' }).getByRole('link', {
      name: 'Weeknight Bread',
    });
    // The index catches up in the background, a moment after the recipe is saved.
    await expect(async () => {
      await page.reload();
      await expect(result).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    const count = page.getByRole('status').filter({ hasText: 'recipe' });
    await expect(count).toHaveText('1 recipe');
    await checkPage(page);

    // Leaving out what it contains finds nothing, until the filter is taken off again.
    await page
      .getByRole('group', { name: 'Leave out recipes with' })
      .getByRole('checkbox', { name: 'wheat' })
      .click();
    await expect(page).toHaveURL(/\/search\?q=crusty&excludeAllergen=wheat$/);
    await expect(count).toHaveText('No recipes match.');
    await checkPage(page);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(count).toHaveText('1 recipe');

    // An ingredient it uses is suggested, and picking it still finds it.
    const picker = page.getByRole('combobox', { name: 'Add an ingredient' });
    await picker.click();
    await picker.fill('flour');
    const suggestion = page.getByRole('option', { name: 'bread flour' });
    await expect(suggestion).toHaveAccessibleDescription('1 recipe');
    await checkPage(page);
    await suggestion.click();
    await expect(page).toHaveURL(/\/search\?q=crusty&ingredient=bread(\+|%20)flour$/);
    await expect(count).toHaveText('1 recipe');
    await page.getByRole('button', { name: 'Remove bread flour' }).click();
    await expect(page).toHaveURL(/\/search\?q=crusty$/);

    await result.click();
    await expect(heading(page, 'Weeknight Bread')).toBeVisible();
  });

  await test.step('it’s rated and kept as a favorite, which the Favorites page lists, rated', async () => {
    const fiveStars = page.getByRole('button', { name: '5 stars' });
    await fiveStars.click();
    await expect(fiveStars).toHaveAttribute('aria-pressed', 'true');
    // The browser's locale decides the decimal separator.
    const rating = /5.0 stars from 1 rating/;
    await expect(page.getByText(rating)).toBeVisible();

    const favorite = page.getByRole('button', { name: 'Favorite' });
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Favorites' })
      .click();

    await expect(heading(page, 'Favorites')).toBeVisible();
    const kept = page
      .getByRole('list', { name: 'Favorites' })
      .getByRole('link', { name: 'Weeknight Bread' });
    await expect(kept).toBeVisible();
    // Its card shows the average alone.
    await expect(page.getByRole('article').getByText(/5.0 stars/)).toBeVisible();
    await checkPage(page);
    await kept.click();
    await expect(heading(page, 'Weeknight Bread')).toBeVisible();
  });

  await test.step('a comment is written on it, the editor loading only once it’s focused', async () => {
    expect(editorRequests).toEqual([]);
    const comments = page.getByRole('region', { name: 'Comments' });
    await expect(comments.getByText('No comments yet.')).toBeVisible();

    await comments.getByRole('textbox', { name: 'Add a comment' }).click();
    const editor = comments.locator('[contenteditable="true"]');
    await expect(editor).toBeFocused();
    expect(editorRequests).not.toEqual([]);
    await page.keyboard.type('Crusty, as promised.');
    await comments.getByRole('button', { name: 'Post comment' }).click();

    const posted = comments.getByRole('listitem').filter({ hasText: 'Crusty, as promised.' });
    await expect(posted).toBeFocused();
    await expect(posted).toContainText(ADMIN.name);
    await checkPage(page);
  });

  await test.step('a note of their own is kept on it, there when they come back', async () => {
    const note = page.getByRole('region', { name: 'Your note' });
    await note.getByRole('textbox', { name: 'Note' }).click();
    await expect(note.locator('[contenteditable="true"]')).toBeFocused();
    await page.keyboard.type('Less salt next time.');
    await note.getByRole('button', { name: 'Save note' }).click();
    await expect(note.getByRole('status')).toHaveText('Note saved.');

    await page.reload();
    await expect(note.getByRole('textbox', { name: 'Note' })).toHaveText('Less salt next time.');
    await checkPage(page);
  });

  await test.step('it’s kept in a new collection, which shows it, from where it opens again', async () => {
    const collections = page.getByRole('button', { name: 'Collections' });
    await collections.click();
    await expect(page.getByRole('menuitem', { name: 'No collections yet' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'New collection…' }).click();
    await expect(heading(page, 'Collections')).toBeFocused();
    await page.getByRole('textbox', { name: 'Name' }).fill('Weeknight');
    await page.getByRole('button', { name: 'Create collection' }).click();
    await expect(page.getByRole('link', { name: 'Weeknight' })).toBeFocused();

    await page.goBack();
    await expect(heading(page, 'Weeknight Bread')).toBeVisible();
    await collections.click();
    const weeknight = page.getByRole('menuitemcheckbox', { name: 'Weeknight' });
    await expect(weeknight).toHaveAttribute('aria-checked', 'false');
    await checkPage(page, { popup: true });
    await weeknight.click();
    await expect(page.getByRole('status').filter({ hasText: 'Added' })).toHaveText(
      'Added to “Weeknight”.',
    );

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Collections' })
      .click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Weeknight' })).toContainText(
      '1 recipe',
    );
    await page.getByRole('link', { name: 'Weeknight' }).click();
    await expect(heading(page, 'Weeknight')).toBeVisible();
    const card = page
      .getByRole('list', { name: 'Recipes in this collection' })
      .getByRole('link', { name: 'Weeknight Bread' });
    await expect(card).toBeVisible();
    await checkPage(page);
    await card.click();
    await expect(heading(page, 'Weeknight Bread')).toBeVisible();

    // Taken out only once confirmed, from a dialog the menu opens as it closes, which leaves the
    // page usable afterwards.
    await collections.click();
    await page.getByRole('menuitemcheckbox', { name: 'Weeknight' }).click();
    await page
      .getByRole('alertdialog', { name: 'Take it out of “Weeknight”?' })
      .getByRole('button', { name: 'Take out' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Taken out' })).toHaveText(
      'Taken out of “Weeknight”.',
    );
    await expect(collections).toBeFocused();
    await collections.click();
    await expect(weeknight).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
  });

  await test.step('cook mode shows its ingredients and every step, and goes back', async () => {
    await page.getByRole('link', { name: 'Cook mode' }).click();

    await expect(page).toHaveURL(/\/cook$/);
    await expect(heading(page, 'Weeknight Bread')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Steps' }).getByRole('listitem')).toHaveText([
      'Mix everything.',
      'Bake at 400°F.',
    ]);
    // Whether the screen can be kept on depends on the browser, but it says which.
    await expect(page.getByRole('status').filter({ hasText: 'screen' })).toBeVisible();
    await checkPage(page);
    await page.getByRole('link', { name: 'Back to recipe' }).click();
    await expect(page.getByRole('link', { name: 'Cook mode' })).toBeVisible();
  });

  await test.step('it prints without the page’s controls or its rating, in the light theme whatever the screen’s', async () => {
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.dataset.printed = 'yes';
      };
    });
    await page.getByRole('button', { name: 'Print' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-printed', 'yes');
    const rating = page.getByText(/5.0 stars from 1 rating/);
    await expect(rating).toBeVisible();

    const colors = () =>
      page.evaluate(() => {
        const { color, backgroundColor } = getComputedStyle(document.body);
        return { color, backgroundColor };
      });
    const theme = (from: string, to: string) =>
      page.evaluate(
        (classes) => document.documentElement.classList.replace(classes.from, classes.to),
        { from, to },
      );
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveClass(/\blight\b/);
    const light = await colors();
    // Dark on screen. (Firefox says the device is light while printing, so the class is set here.)
    await theme('light', 'dark');
    await expect.poll(colors).not.toEqual(light);

    await page.emulateMedia({ media: 'print' });
    await expect.poll(colors).toEqual(light);
    await expect(heading(page, 'Weeknight Bread')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Ingredients' }).getByRole('listitem'),
    ).toHaveCount(1);
    for (const role of ['navigation', 'button', 'textbox', 'radio'] as const) {
      await expect(page.getByRole(role), `no ${role} on paper`).toHaveCount(0);
    }
    await expect(rating, 'no rating on paper').toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await theme('dark', 'light');
  });

  await test.step('a tag is renamed on the Tags page, and the recipe shows the new name', async () => {
    const address = new URL(page.url()).pathname;
    await openAdminPage(page, 'Tags');
    await expect(heading(page, 'Tags')).toBeVisible();
    const american = page
      .getByRole('table', { name: 'Cuisines' })
      .getByRole('row', { name: /American/ });
    await expect(american.getByRole('cell')).toHaveText(['American', '1', /Rename/]);
    await checkPage(page);

    await page.getByRole('button', { name: 'Rename American' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename “American”' });
    await expect(dialog).toBeVisible();
    await checkPage(page, { popup: true });
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Southern');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Renamed' })).toHaveText(
      'Renamed “American” to “Southern”.',
    );

    await page.goto(address);
    await expect(
      page.getByRole('main').getByRole('list', { name: 'Tags' }).getByRole('listitem'),
    ).toHaveText(['Contains wheat', 'Southern']);
  });
});

test('the recipe is revised, deleted and restored from the trash', async ({ page }) => {
  await signInAsAdmin(page);
  const listed = listedRecipe(page);
  await page.goto(recipePath);
  await expect(heading(page, 'Weeknight Bread')).toBeVisible();

  await test.step('an edit is saved as a draft, continued later, and published with what changed', async () => {
    await page.getByRole('link', { name: 'Edit recipe' }).click();
    await expect(heading(page, 'Edit recipe')).toBeVisible();
    await page.getByRole('textbox', { name: 'Servings' }).fill('10');
    await page.getByRole('textbox', { name: 'Ingredient 1' }).fill('600 g bread flour');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible();
    await page.getByRole('link', { name: 'Cancel' }).click();

    // The recipe is still as published, and says it has a draft.
    await expect(heading(page, 'Weeknight Bread')).toBeVisible();
    await expect(page.getByText(/^You saved a draft of this recipe on /)).toBeVisible();
    await checkPage(page);
    await page.getByRole('link', { name: 'Continue draft' }).click();

    await expect(page.getByText(/^You're continuing the draft you saved on /)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Servings' })).toHaveValue('10');
    await page.getByRole('textbox', { name: 'What changed' }).fill('Serves more');
    await checkPage(page);
    await page.getByRole('button', { name: 'Publish' }).click();

    await expect(heading(page, 'Weeknight Bread')).toBeVisible();
    await expect(page.getByText('Revision 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit recipe' })).toBeVisible();
  });

  await test.step('its history lists both revisions, compares them, and shows the first as it was', async () => {
    await page.getByRole('link', { name: 'History' }).click();
    const revisions = page.getByRole('list', { name: 'Revisions' }).getByRole('listitem');
    await expect(revisions).toHaveCount(2);
    await expect(revisions.first()).toContainText('Serves more');
    await checkPage(page);

    await page.getByRole('link', { name: 'Compare with revision 1' }).click();
    await expect(
      page.getByRole('table', { name: 'Details' }).getByRole('row', { name: /Servings/ }),
    ).toHaveText(/Servings\s*8\s*10/);
    const changed = page.getByRole('list', { name: 'Ingredients' }).getByRole('listitem').first();
    await expect(changed.locator('del')).toHaveText('Removed: 500');
    await expect(changed.locator('ins')).toHaveText('Added: 600');
    await checkPage(page);
    await page.getByRole('link', { name: 'Back to history' }).click();

    await page.getByRole('link', { name: 'Revision 1', exact: true }).click();
    await expect(heading(page, 'Weeknight Bread')).toBeVisible();
    await expect(
      page.getByText('The recipe was published again since, and is at revision 2 now.', {
        exact: false,
      }),
    ).toBeVisible();
    // Its tags with the names they had then, before the rename.
    await expect(
      page.getByRole('main').getByRole('list', { name: 'Tags' }).getByRole('listitem'),
    ).toHaveText(['Contains wheat', 'American']);
    await checkPage(page);
  });

  await test.step('restoring the first revision publishes it again, as the third', async () => {
    await page.getByRole('button', { name: 'Restore this revision' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Restore revision 1?' });
    await expect(dialog).toBeVisible();
    await checkPage(page, { popup: true });
    await dialog.getByRole('button', { name: 'Restore' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Restored' })).toHaveText(
      'Restored revision 1. It’s published as revision 3.',
    );
    await expect(page.getByText('Revision 3', { exact: true })).toBeVisible();
    // Its tags are the same tags, with the names they have now.
    await expect(
      page.getByRole('main').getByRole('list', { name: 'Tags' }).getByRole('listitem'),
    ).toHaveText(['Contains wheat', 'Southern']);

    await page.getByRole('link', { name: 'History' }).click();
    await expect(
      page.getByRole('list', { name: 'Revisions' }).getByRole('listitem').first(),
    ).toContainText('Restored from revision #1');
    await page.getByRole('link', { name: 'Back to recipe' }).click();
    await expect(page.getByText('Revision 3', { exact: true })).toBeVisible();
  });

  await test.step('the recipe is deleted once asked, which the audit log records', async () => {
    const address = new URL(page.url()).pathname;
    const id = address.split('/').at(-1);
    await page.getByRole('button', { name: 'Delete recipe' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete “Weeknight Bread”?' });
    await expect(dialog).toBeVisible();
    await checkPage(page, { popup: true });
    await dialog.getByRole('button', { name: 'Delete recipe' }).click();

    await expect(heading(page, 'Recipes')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Deleted' })).toHaveText(
      'Deleted “Weeknight Bread”.',
    );
    await expect(page.getByText('No recipes yet.')).toBeVisible();
    await expect(listed).toBeHidden();
    await checkPage(page);

    const response = await page.request.get('/api/v1/audit-events?action=recipe.deleted');
    expect(response.status()).toBe(200);
    const { events } = (await response.json()) as { events: { target: { id: string } | null }[] };
    expect(events.map(({ target }) => target?.id)).toEqual([id]);

    await page.goto(address);
    await expect(heading(page, 'Recipe not found')).toBeVisible();
  });

  await test.step('the trash restores it as it was, which the audit log records', async () => {
    await page.getByRole('button', { name: `Account: ${ADMIN.name}` }).click();
    await page.getByRole('menuitem', { name: 'Trash' }).click();

    await expect(heading(page, 'Trash')).toBeVisible();
    const restore = page.getByRole('button', { name: 'Restore Weeknight Bread' });
    await expect(restore).toBeVisible();
    await checkPage(page);
    await restore.click();

    await expect(page.getByText('The trash is empty.')).toBeVisible();
    const status = page.getByRole('status').filter({ hasText: 'Restored' });
    await expect(status).toHaveText('Restored “Weeknight Bread”. Go to the recipe');
    await status.getByRole('link', { name: 'Go to the recipe' }).click();
    await expect(heading(page, 'Weeknight Bread')).toBeVisible();
    await expect(page.getByText('Revision 3', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Favorite' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const id = new URL(page.url()).pathname.split('/').at(-1);
    const response = await page.request.get('/api/v1/audit-events?action=recipe.restored');
    expect(response.status()).toBe(200);
    const { events } = (await response.json()) as { events: { target: { id: string } | null }[] };
    expect(events.map(({ target }) => target?.id)).toEqual([id]);

    await page.getByRole('link', { name: 'myli', exact: true }).click();
    await expect(listed).toBeVisible();
  });
});
