---
status: accepted
date: 2026-11-27
---

# Email verification and password reset with myli's own tokens, sent from jobs

Amends two points of [ADR 0005](./0005-better-auth-instance-roles-and-invitations.md): who sends verification and reset emails, and when accepting an invitation verifies an address. It also narrows the driver of [ADR 0010](./0010-role-changes-and-deactivation-in-one-transaction.md) that kept credentials Better Auth's to write. Everything else in both stands.

## Context and Problem Statement

ADR 0005 left email verification and password reset to Better Auth, "sent through the app's mailer". Phase 5 builds them (spec §3.1), and Better Auth's flows don't fit how myli sends email or what a verified address has to mean here.

- **Email is sent only from jobs,** never inside a request, and a secret never goes in a job's payload: the job makes the token, stores its hash and then sends (CLAUDE.md, Email; invitations do this). Better Auth makes the token inside the request and hands it to a callback (`sendResetPassword`, `sendVerificationEmail`) to send then. Sending from a job would mean putting the token in the payload, or throwing it away and making another through Better Auth's internal adapter.
- **Its verification tokens can't be used up or revoked.** They're JWTs signed with `BETTER_AUTH_SECRET`, good for their whole lifetime, however many times they're opened.
- **A reset is only safe to an address that was proven.** Every account here was typed in by someone else: an admin inviting, or whoever ran first-run setup. A typo would send reset links to a stranger, who could take over the account. Better Auth sends a reset link to any address that has an account, and to deactivated accounts too.
- **Every account was marked verified without proof.** `createUserWithPassword()` sets `emailVerified` for setup and every accepted invitation, including invitations whose link the admin copied and sent some other way.
- **Admins may not read private recipes** (spec §2). Anything that lets an admin take over someone's sign-in breaks that, and an admin-made reset link would.
- **Nothing limits how often a reset email goes to one inbox,** except a limit per client address, which anyone can change.

How should verification and reset work, and who makes and sends their links?

## Decision Drivers

- Emails are sent from jobs, and no secret is in a payload or stored unhashed.
- A link works once, expires, and only the newest one for an account works.
- Using a link, the change it makes, and its audit event commit together.
- Only an address myli has proven gets reset links.
- No path gives an admin, or anyone else, someone's password or a way to set it.
- Recovery still works without SMTP, for whoever runs the server.
- Password hashing and sessions stay Better Auth's.

## Considered Options

- myli's own tokens, like invitations, sent from jobs; Better Auth's endpoints for both blocked
- Better Auth's flows, its callbacks queueing a job that makes another token through its internal adapter
- Better Auth's flows as they are, sending from the callback inside the request

## Decision Outcome

Chosen option: **myli's own tokens, sent from jobs**, as invitations already are.

**Tokens**
- One table, `user_token`, holds them:
  - the user, and the token's purpose (`verify_email` or `reset_password`, under a CHECK constraint)
  - the SHA-256 hash of its 32 random bytes
  - the address it was made for, its expiry, and when it was made
- **One per user and purpose.** Making a new one deletes the old, so only the newest link works.
- **Using one deletes it,** in the transaction that acts on it, with a conditional delete. Of two uses at the same moment, exactly one succeeds. Unknown, expired and used links get the same answer.
- Verification links last a day; reset links an hour. Each is in the link's fragment, as an invitation's is: `PUBLIC_URL/verify-email#<token>`, `PUBLIC_URL/reset-password#<token>`.

**Sending**
- A request for a link inserts the row with the hash of a token nobody sees, and queues its email job in the same transaction. The payload is the row's ID.
- The job stores the hash of a fresh token and only then sends, as `invitationEmailJob` does. If the row has been replaced or used since, the job sends nothing. A job that runs twice sends twice, and only the newer link works.
- **One email per account and purpose every five minutes.** A request that comes sooner than that after the last one sends nothing. For a reset, it gets the same answer anyway. Asking for verification, the account's owner is told to wait.

**Verified addresses**
- `user.email_verified` (Better Auth's column) is true only once myli has proven the address:
  - the account came from an invitation whose current link was emailed, recorded on the invitation by the job that sent it
  - or its owner opened a verification link made for that address
- **Accounts from first-run setup, or from a copied invitation link, start unverified.** A migration makes every existing account unverified, since none was proven.
- Signing in never needs a verified address. Only reset emails do.

**Resetting a password**
- A reset email goes only to the verified address of an active account. Anyone may ask, without signing in, and gets the same answer either way.
- Using the link sets the new password and deletes every one of the account's sessions, in one transaction with its audit event. A deactivated account's link doesn't work.
  - Better Auth hashes the new password, with the hasher it signs in with (`password.hash` from `auth.$context`).
  - myli writes the hash to the account's credential.
- **Without SMTP,** whoever runs the server makes a reset link from the command line (`reset-password.ts <email>`). The link works the same way, for any active account, verified or not. That person can read the database already, so this gives them nothing new. It also covers an instance whose only admin forgot their password.
- **Admins can't make reset links in the app.** An admin who saw one could sign in as that person and read their private recipes.

**Changing a password** stays Better Auth's `/change-password`, which checks the current password and signs out the account's other sessions. Its audit event is written from its response, as sign-ins' are, since Better Auth makes the change itself.

**Better Auth's own endpoints for these are blocked** for every caller, as the admin plugin's are: `/request-password-reset`, `/reset-password` (and `/reset-password/:token`), `/send-verification-email`, `/verify-email` and `/change-email`. Changing an address isn't offered, and would make an address verified for one email stand for another.

ADR 0010's driver "Better Auth stays the only writer of users, credentials and new sessions" is narrowed again: Better Auth stays the only writer of users, of credentials when they're created, and of new sessions. A reset writes only the password column, with a hash from Better Auth's own hasher.

### Consequences

- Good, because email is still sent only from jobs, no token is in a payload, and every token is stored as a hash.
- Good, because a reset link only ever goes to an address that's been proven, and never to an admin.
- Good, because using a link, its change and its audit event are atomic, as for invitations.
- Good, because the operator can still recover any account without SMTP.
- Bad, because everyone has to verify their address once, after upgrading, before they can reset a password by email.
- Bad, because there's a second token module to keep secure. It's the same small pattern as invitations, sharing their helpers.
- Bad, because a Better Auth upgrade that changed how it stores credentials would need the reset's write updated. The test that signs in with a reset password would catch it.

### Confirmation

Tests cover:
- each link working once, two uses at the same moment succeeding once, and a newer link stopping an older one
- unknown, expired and used links getting the same answer
- the email job storing its token's hash before sending, and sending nothing for a token that was replaced or used
- a reset email going only to a verified address of an active account, at most once every five minutes, with the same answer either way
- a reset setting a password that signs in, ending every session, and refusing a deactivated account
- an emailed invitation verifying its address, and a copied one not
- Better Auth's reset and verification endpoints answering 404

## Pros and Cons of the Options

### myli's own tokens, sent from jobs

- Good, because it follows rules myli already keeps, with code like the invitations', which is tested the same way.
- Bad, because it's more code than turning on Better Auth's options.

### Better Auth's flows, with a job making a second token

- Good, because Better Auth would store and check reset tokens itself.
- Bad, because the job would make tokens through Better Auth's internal adapter, which isn't public API.
- Bad, because verification tokens would still be JWTs that work many times and can't be revoked.
- Bad, because the rules on who gets a reset, how often, and the audit events would all be hooks around flows we don't own.

### Better Auth's flows as they are

- Good, because it's least code.
- Bad, because email would be sent inside requests: a slow or failing SMTP server would slow or fail the request, with no retry.
- Bad, because it shares the other option's problems with verification tokens and reset rules.

## More Information

- Spec: [`docs/spec.md`](../spec.md), §3.1 accounts and access
- [ADR 0005](./0005-better-auth-instance-roles-and-invitations.md): Better Auth, roles and invitations
- [ADR 0010](./0010-role-changes-and-deactivation-in-one-transaction.md): writing Better Auth's columns directly
