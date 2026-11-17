import type { Page } from '@playwright/test';
import { checkPage } from './accessibility.ts';
import { expect, test } from './fixtures.ts';

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

// The tests after the first sign in with the admin it set up, so each needs the one before.
test.describe.configure({ mode: 'serial' });

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
// `exact`, so "Show password" doesn't match too.
const passwordField = (page: Page) => page.getByLabel('Password', { exact: true });

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
    // An editor's header links only to a new recipe, with no Admin menu.
    await expect(member.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([
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

test('an admin writes a recipe, with a formatted description, steps and tags', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(ADMIN.email);
  await signIn(page, ADMIN);
  await expect(heading(page, 'Recipes')).toBeVisible();

  await test.step('the description is edited in place, with its toolbar', async () => {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'New recipe' })
      .click();
    await expect(heading(page, 'New recipe')).toBeVisible();
    await page.getByRole('textbox', { name: 'Title' }).fill('Weeknight Bread');
    await page.getByRole('textbox', { name: 'Servings' }).fill('8');

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

  await test.step('the recipe is deleted once asked, which the audit log records', async () => {
    const address = new URL(page.url()).pathname;
    const id = address.split('/').at(-1);
    await page.getByRole('button', { name: 'Delete recipe' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete “Weeknight Bread”?' });
    await expect(dialog).toBeVisible();
    await checkPage(page, { popup: true });
    await dialog.getByRole('button', { name: 'Delete recipe' }).click();

    await expect(heading(page, 'Recipes')).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Deleted “Weeknight Bread”.');
    await checkPage(page);

    const response = await page.request.get('/api/v1/audit-events?action=recipe.deleted');
    expect(response.status()).toBe(200);
    const { events } = (await response.json()) as { events: { target: { id: string } | null }[] };
    expect(events.map(({ target }) => target?.id)).toEqual([id]);

    await page.goto(address);
    await expect(heading(page, 'Recipe not found')).toBeVisible();
  });
});
