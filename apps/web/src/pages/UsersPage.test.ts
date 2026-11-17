import type { Role } from '@myli/shared';
import { screen, waitFor, within } from '@testing-library/vue';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { UserAccount } from '@/admin/users.ts';
import {
  accessibilityViolations,
  answerSession,
  apiServer,
  problemResponse,
  renderApp,
  testUsers,
} from '@/testing.ts';

const ME: UserAccount = {
  ...testUsers.admin,
  deactivated: false,
  createdAt: '2026-01-05T09:00:00.000Z',
};
const KATHERINE: UserAccount = {
  id: 'user-katherine',
  name: 'Katherine Johnson',
  email: 'katherine@example.com',
  role: 'editor',
  deactivated: false,
  createdAt: '2026-02-10T09:00:00.000Z',
};
const MARGARET: UserAccount = {
  id: 'user-margaret',
  name: 'Margaret Hamilton',
  email: 'margaret@example.com',
  role: 'viewer',
  deactivated: true,
  createdAt: '2026-03-01T09:00:00.000Z',
};
const FORBIDDEN = "You don't have permission to do this.";

const joined = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));

/** An answer in place of the fake API's own, which it falls back to when this gives none. */
type Answer = (
  store: UserAccount[],
  id: string,
) => Response | undefined | Promise<Response | undefined>;

interface FakeApiOptions {
  list?: () => Response | Promise<Response>;
  changeRole?: Answer;
  deactivate?: Answer;
  reactivate?: Answer;
}

/**
 * The users page, as an admin, with a fake API that keeps the list of users: changing a role or
 * deactivating someone changes their entry. Returns the list, and what each request sent.
 */
async function renderUsers(options: FakeApiOptions = {}) {
  const store: UserAccount[] = [{ ...ME }, { ...KATHERINE }, { ...MARGARET }];
  const sent = {
    lists: 0,
    roles: [] as { id: string; role: Role }[],
    deactivations: [] as string[],
    reactivations: [] as string[],
  };
  const update = async (
    id: string,
    answer: Answer | undefined,
    change: Partial<UserAccount>,
  ): Promise<Response> => {
    const answered = await answer?.(store, id);
    if (answered) return answered;
    const user = store.find((candidate) => candidate.id === id);
    if (!user) return problemResponse(404, 'No user has this ID.');
    Object.assign(user, change);
    return HttpResponse.json({ user });
  };
  apiServer.use(
    http.get('/api/v1/users', () => {
      sent.lists += 1;
      return options.list?.() ?? HttpResponse.json({ users: store });
    }),
    http.put<{ id: string }>('/api/v1/users/:id/role', async ({ params: { id }, request }) => {
      const { role } = (await request.json()) as { role: Role };
      sent.roles.push({ id, role });
      return update(id, options.changeRole, { role });
    }),
    http.post<{ id: string }>('/api/v1/users/:id/deactivate', ({ params: { id } }) => {
      sent.deactivations.push(id);
      return update(id, options.deactivate, { deactivated: true });
    }),
    http.post<{ id: string }>('/api/v1/users/:id/reactivate', ({ params: { id } }) => {
      sent.reactivations.push(id);
      return update(id, options.reactivate, { deactivated: false });
    }),
  );
  const rendered = await renderApp('/admin/users', { signedInAs: 'admin' });
  return { ...rendered, store, sent };
}

const table = () => screen.findByRole('table', { name: 'Users' });
const pageHeading = () => screen.getByRole('heading', { level: 1, name: 'Users' });
const changeRoleButton = (name: string) =>
  screen.getByRole('button', { name: `Change role for ${name}` });
const deactivateButton = (name: string) =>
  screen.getByRole('button', { name: `Deactivate ${name}` });
const reactivateButton = (name: string) =>
  screen.getByRole('button', { name: `Reactivate ${name}` });
const roleDialog = (name: string) => screen.findByRole('dialog', { name: `Change ${name}'s role` });
const deactivateDialog = (name: string) =>
  screen.findByRole('alertdialog', { name: `Deactivate ${name}?` });
const roleRadio = (scope: HTMLElement, name: string) => within(scope).getByRole('radio', { name });
/** The page's own notices, after a change. */
const notice = () => screen.getByText(/ is now |^Deactivated |^Reactivated /);
/** Long enough for a second request to be sent, if a second press had started one. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

/** The text of each row's cells, header row included, without the buttons. */
async function tableText() {
  return within(await table())
    .getAllByRole('row')
    .map((row) =>
      [...row.querySelectorAll('th, td')]
        .slice(0, 5)
        .map((cell) => cell.textContent.replace(/\s+/g, ' ').trim()),
    );
}

/** The row of the user with this name. */
async function row(name: string) {
  const found = within(await table())
    .getAllByRole('row')
    .find((candidate) => candidate.querySelector('td')?.textContent.trim().startsWith(name));
  if (!found) throw new Error(`No row for ${name}`);
  return found;
}

describe('the users page', () => {
  it('lists everyone as the API gives them, oldest first', async () => {
    await renderUsers();

    expect(await tableText()).toEqual([
      ['Name', 'Email', 'Role', 'Status', 'Joined'],
      [`${ME.name} You`, ME.email, 'Admin', 'Active', joined(ME.createdAt)],
      [KATHERINE.name, KATHERINE.email, 'Editor', 'Active', joined(KATHERINE.createdAt)],
      [MARGARET.name, MARGARET.email, 'Viewer', 'Deactivated', joined(MARGARET.createdAt)],
    ]);
    const time = (await row(KATHERINE.name)).querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(KATHERINE.createdAt);
  });

  it('marks their own row, which has no controls, and says why', async () => {
    await renderUsers();

    const mine = await row(ME.name);
    expect(within(mine).getByText('You')).toBeDefined();
    expect(within(mine).queryAllByRole('button')).toEqual([]);
    expect(
      screen.getByText(
        "You can't change your own role or deactivate yourself. Another admin has to.",
      ),
    ).toBeDefined();
    expect(within(await row(KATHERINE.name)).queryByText('You')).toBeNull();
  });

  it('offers to deactivate active users and reactivate deactivated ones', async () => {
    await renderUsers();
    await table();

    expect(changeRoleButton(KATHERINE.name)).toBeDefined();
    expect(deactivateButton(KATHERINE.name)).toBeDefined();
    expect(screen.queryByRole('button', { name: `Reactivate ${KATHERINE.name}` })).toBeNull();
    expect(changeRoleButton(MARGARET.name)).toBeDefined();
    expect(reactivateButton(MARGARET.name)).toBeDefined();
    expect(screen.queryByRole('button', { name: `Deactivate ${MARGARET.name}` })).toBeNull();
  });

  it('says it is loading them while it is', async () => {
    const answered = Promise.withResolvers<undefined>();
    await renderUsers({
      list: async () => {
        await answered.promise;
        return HttpResponse.json({ users: [ME] });
      },
    });

    expect(screen.getByText('Loading users…').getAttribute('role')).toBe('status');
    answered.resolve(undefined);
    await table();
  });

  it('says so when they could not be loaded, and tries again when asked', async () => {
    let answer = () => problemResponse(500, 'Internal Server Error');
    const { user, sent } = await renderUsers({ list: () => answer() });

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    expect(sent.lists).toBe(3);

    answer = () => HttpResponse.json({ users: [ME, KATHERINE] });
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await table();
    await waitFor(() => {
      expect(document.activeElement).toBe(pageHeading());
    });
  });

  it('has no accessibility violations', async () => {
    await renderUsers();
    await table();

    expect(await accessibilityViolations()).toEqual([]);
  });
});

describe("changing someone's role", () => {
  it('opens a dialog with their role chosen, saves the new one and updates the list', async () => {
    const { user, sent } = await renderUsers();
    await table();

    await user.click(changeRoleButton(KATHERINE.name));

    const dialog = await roleDialog(KATHERINE.name);
    expect(dialog.textContent).toContain('The change applies the next time they use myli.');
    expect(roleRadio(dialog, 'Editor').getAttribute('aria-checked')).toBe('true');
    expect(roleRadio(dialog, 'Viewer').getAttribute('aria-checked')).toBe('false');
    // See the theme menu's test for `region`.
    expect(await accessibilityViolations({ skip: ['region'] })).toEqual([]);

    await user.click(roleRadio(dialog, 'Admin'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe('Katherine Johnson is now an admin.');
    });
    expect(notice().getAttribute('role')).toBe('status');
    expect(sent.roles).toEqual([{ id: KATHERINE.id, role: 'admin' }]);
    expect((await tableText())[2]?.[2]).toBe('Admin');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(changeRoleButton(KATHERINE.name));
    });
  });

  it('starts from their current role each time the dialog opens', async () => {
    const { user } = await renderUsers();
    await table();
    await user.click(changeRoleButton(KATHERINE.name));
    await user.click(roleRadio(await roleDialog(KATHERINE.name), 'Viewer'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    await user.click(changeRoleButton(MARGARET.name));

    expect(roleRadio(await roleDialog(MARGARET.name), 'Viewer').getAttribute('aria-checked')).toBe(
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(changeRoleButton(KATHERINE.name));
    expect(roleRadio(await roleDialog(KATHERINE.name), 'Editor').getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('changes nothing when they cancel, and goes back to the button', async () => {
    const { user, sent } = await renderUsers();
    await table();

    await user.click(changeRoleButton(KATHERINE.name));
    await user.click(roleRadio(await roleDialog(KATHERINE.name), 'Viewer'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(changeRoleButton(KATHERINE.name));
    expect(sent.roles).toEqual([]);
    expect((await tableText())[2]?.[2]).toBe('Editor');
  });

  it('sends nothing when the role is the one they already have', async () => {
    const { user, sent } = await renderUsers();
    await table();

    await user.click(changeRoleButton(KATHERINE.name));
    await user.click(
      within(await roleDialog(KATHERINE.name)).getByRole('button', { name: 'Save' }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await settle();
    expect(sent.roles).toEqual([]);
    expect(notice).toThrow();
  });

  it('says why in the dialog when the API refuses, keeping it open', async () => {
    const { user } = await renderUsers({
      changeRole: () => problemResponse(404, 'No user has this ID.'),
    });
    await table();

    await user.click(changeRoleButton(KATHERINE.name));
    const dialog = await roleDialog(KATHERINE.name);
    await user.click(roleRadio(dialog, 'Viewer'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect((await within(dialog).findByRole('alert')).textContent.trim()).toBe(
      'No user has this ID.',
    );
    expect(roleRadio(dialog, 'Viewer').getAttribute('aria-checked')).toBe('true');

    // Opening it again starts afresh.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect((await tableText())[2]?.[2]).toBe('Editor');
    await user.click(changeRoleButton(KATHERINE.name));
    expect(within(await roleDialog(KATHERINE.name)).queryByRole('alert')).toBeNull();
  });

  it('saves once, even when Save is pressed twice quickly', async () => {
    const answered = Promise.withResolvers<undefined>();
    const { user, sent } = await renderUsers({
      changeRole: async () => {
        await answered.promise;
        return undefined;
      },
    });
    await table();

    await user.click(changeRoleButton(KATHERINE.name));
    const dialog = await roleDialog(KATHERINE.name);
    await user.click(roleRadio(dialog, 'Viewer'));
    const save = within(dialog).getByRole('button', { name: 'Save' });
    await user.click(save);
    expect(save.getAttribute('aria-disabled')).toBe('true');
    await user.click(save);
    await settle();
    answered.resolve(undefined);

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe('Katherine Johnson is now a viewer.');
    });
    expect(sent.roles).toHaveLength(1);
  });
});

describe('deactivating someone', () => {
  it('asks first, then marks them deactivated and moves focus to Reactivate', async () => {
    const { user, sent } = await renderUsers();
    await table();

    await user.click(deactivateButton(KATHERINE.name));

    const confirm = await deactivateDialog(KATHERINE.name);
    expect(confirm.textContent).toContain(
      "They're signed out everywhere and can't sign in until an admin reactivates them. Their recipes stay as they are: private ones stay private, and shared ones stay shared.",
    );
    // See the theme menu's test for `region`.
    expect(await accessibilityViolations({ skip: ['region'] })).toEqual([]);
    expect(sent.deactivations).toEqual([]);

    await user.click(within(confirm).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe(
        "Deactivated Katherine Johnson. They've been signed out.",
      );
    });
    expect(sent.deactivations).toEqual([KATHERINE.id]);
    expect((await tableText())[2]?.[3]).toBe('Deactivated');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // The button they pressed was replaced, so focus goes to the one in its place.
    await waitFor(() => {
      expect(document.activeElement).toBe(reactivateButton(KATHERINE.name));
    });
  });

  it('does nothing when they cancel, and goes back to the button', async () => {
    const { user, sent } = await renderUsers();
    await table();

    await user.click(deactivateButton(KATHERINE.name));
    await user.click(
      within(await deactivateDialog(KATHERINE.name)).getByRole('button', { name: 'Cancel' }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(document.activeElement).toBe(deactivateButton(KATHERINE.name));
    expect(sent.deactivations).toEqual([]);
  });

  it('says so when deactivating failed, leaving them active', async () => {
    let fail = true;
    const { user } = await renderUsers({
      deactivate: () => (fail ? problemResponse(500, 'Internal Server Error') : undefined),
    });
    await table();

    await user.click(deactivateButton(KATHERINE.name));
    await user.click(
      within(await deactivateDialog(KATHERINE.name)).getByRole('button', { name: 'Deactivate' }),
    );

    expect((await screen.findByRole('alert')).textContent.trim()).toBe(
      "Something went wrong on myli's server. Try again in a moment.",
    );
    expect((await tableText())[2]?.[3]).toBe('Active');
    expect(document.activeElement).toBe(deactivateButton(KATHERINE.name));

    // Trying again clears the message.
    fail = false;
    await user.click(deactivateButton(KATHERINE.name));
    await user.click(
      within(await deactivateDialog(KATHERINE.name)).getByRole('button', { name: 'Deactivate' }),
    );

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe(
        "Deactivated Katherine Johnson. They've been signed out.",
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('deactivates once, even when confirmed again while the first is under way', async () => {
    const answered = Promise.withResolvers<undefined>();
    const { user, sent } = await renderUsers({
      deactivate: async () => {
        await answered.promise;
        return undefined;
      },
    });
    await table();

    await user.click(deactivateButton(KATHERINE.name));
    await user.click(
      within(await deactivateDialog(KATHERINE.name)).getByRole('button', { name: 'Deactivate' }),
    );
    await user.click(deactivateButton(KATHERINE.name));
    await user.click(
      within(await deactivateDialog(KATHERINE.name)).getByRole('button', { name: 'Deactivate' }),
    );
    await settle();
    answered.resolve(undefined);

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe(
        "Deactivated Katherine Johnson. They've been signed out.",
      );
    });
    expect(sent.deactivations).toHaveLength(1);
  });
});

describe('reactivating someone', () => {
  it('reactivates them straight away and moves focus to Deactivate', async () => {
    const { user, sent } = await renderUsers();
    await table();

    await user.click(reactivateButton(MARGARET.name));

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe(
        'Reactivated Margaret Hamilton. They can sign in again.',
      );
    });
    expect(sent.reactivations).toEqual([MARGARET.id]);
    expect((await tableText())[3]?.[3]).toBe('Active');
    await waitFor(() => {
      expect(document.activeElement).toBe(deactivateButton(MARGARET.name));
    });
  });

  it('says so when reactivating failed, a message the next success clears', async () => {
    let fail = true;
    const { user } = await renderUsers({
      reactivate: () => (fail ? problemResponse(404, 'No user has this ID.') : undefined),
    });
    await table();

    await user.click(reactivateButton(MARGARET.name));

    expect((await screen.findByRole('alert')).textContent.trim()).toBe('No user has this ID.');
    expect((await tableText())[3]?.[3]).toBe('Deactivated');
    expect(document.activeElement).toBe(reactivateButton(MARGARET.name));

    fail = false;
    await user.click(reactivateButton(MARGARET.name));

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe(
        'Reactivated Margaret Hamilton. They can sign in again.',
      );
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reactivates once, even when the button is pressed twice quickly', async () => {
    const answered = Promise.withResolvers<undefined>();
    const { user, sent } = await renderUsers({
      reactivate: async () => {
        await answered.promise;
        return undefined;
      },
    });
    await table();

    await user.click(reactivateButton(MARGARET.name));
    expect(reactivateButton(MARGARET.name).getAttribute('aria-disabled')).toBe('true');
    await user.click(reactivateButton(MARGARET.name));
    await settle();
    answered.resolve(undefined);

    await waitFor(() => {
      expect(notice().textContent.trim()).toBe(
        'Reactivated Margaret Hamilton. They can sign in again.',
      );
    });
    expect(sent.reactivations).toHaveLength(1);
  });
});

describe('an admin whose own role changed meanwhile', () => {
  it('is refused, and loses the page once myli sees their new role', async () => {
    const demoted = { ...testUsers.admin, role: 'editor' as const };
    answerSession(testUsers.admin);
    let isAdmin = true;
    const refuse = () => (isAdmin ? undefined : problemResponse(403, FORBIDDEN));
    const { user, router } = await renderUsers({
      list: () => refuse() ?? HttpResponse.json({ users: [ME, KATHERINE, MARGARET] }),
      reactivate: refuse,
    });
    await table();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeDefined();

    // Another admin made them an editor.
    isAdmin = false;
    answerSession(demoted);
    await user.click(reactivateButton(MARGARET.name));

    await screen.findByRole('heading', { level: 1, name: "You don't have access to this page" });
    expect(router.currentRoute.value.fullPath).toBe('/admin/users');
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.getByRole('button', { name: `Account: ${demoted.name}` })).toBeDefined();
    await settle();
  });
});
