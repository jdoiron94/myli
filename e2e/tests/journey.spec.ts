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

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
// `exact`, so "Show password" doesn't match too.
const passwordField = (page: Page) => page.getByLabel('Password', { exact: true });

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

  let link = '';
  await test.step('the admin invites someone as an admin, and gets the link to share', async () => {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Invitations' })
      .click();
    await expect(heading(page, 'Invitations')).toBeVisible();
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
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Users' })
      .click();

    await expect(heading(page, 'Users')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Users' })).toContainText(MEMBER.email);
    await checkPage(page);
  });

  await test.step('deactivating them signs them out everywhere', async () => {
    // They're on the Users page too, as an admin.
    await member
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Users' })
      .click();
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
    await expect(member.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await checkPage(member);
  });

  await test.step('the admin signs out', async () => {
    await page.getByRole('button', { name: `Account: ${ADMIN.name}` }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(heading(page, 'Sign in')).toBeVisible();
  });
});
