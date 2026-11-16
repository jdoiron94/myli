# Changelog

## 0.1.0 (2026-11-16)


### Features

* **api:** add an append-only audit log for setup, invitations, sign-ins and sign-outs ([ff5cd9d](https://github.com/jdoiron94/myli/commit/ff5cd9d232fd47feb6f18130fffe62af4731b859))
* **api:** add an SMTP mailer and give job handlers services ([6798ef5](https://github.com/jdoiron94/myli/commit/6798ef59815a8e2ff4fe2a2c1c51cb31dcc876aa))
* **api:** add Better Auth with email/password, roles and disabled sign-up ([6c216c9](https://github.com/jdoiron94/myli/commit/6c216c9d9e87748307e845041c304ee786efcaca))
* **api:** add first-run setup with a claim lock and password rules ([92d13c5](https://github.com/jdoiron94/myli/commit/92d13c5a7f383ef9852af7390646f1f5f9b3625f))
* **api:** add Hono app with /healthz and Node entry point ([3a9dc35](https://github.com/jdoiron94/myli/commit/3a9dc3522d1467bf32d1e69e86a72888f67b4b39))
* **api:** add invitations with create, lookup and accept ([2578ba9](https://github.com/jdoiron94/myli/commit/2578ba9275127f0f2fb97996aafe8630f1ca9813))
* **api:** add job queue with transactional enqueue and worker ([dc60077](https://github.com/jdoiron94/myli/commit/dc60077127aaf5ab648da195338f3de4a3683a15))
* **api:** add pino request logging with request IDs ([b3ae314](https://github.com/jdoiron94/myli/commit/b3ae3144b7fa01e28c53429cdebc4bd14b56a64c))
* **api:** add session middleware with requireSession guard ([d0113d0](https://github.com/jdoiron94/myli/commit/d0113d01847133d2397767112132eb8d25d09bb1))
* **api:** add SQLite with Drizzle, startup migrations and the job table ([062cb0e](https://github.com/jdoiron94/myli/commit/062cb0e5f4aa31972921336f152fa569cc4dd968))
* **api:** add the API's Docker image ([f4ce9b6](https://github.com/jdoiron94/myli/commit/f4ce9b64aa88579184c5966e94b3ea762d9200fe))
* **api:** add the demo seed script ([8d89653](https://github.com/jdoiron94/myli/commit/8d896530d0ea42789cc5632ae70afdc127164ad2))
* **api:** connect to Meilisearch with a scoped key and add /readyz ([8059d82](https://github.com/jdoiron94/myli/commit/8059d82d7f2f7f08282d653d1fcf8bde59c8ed2d))
* **api:** create the first admin from env vars at startup ([2e10c18](https://github.com/jdoiron94/myli/commit/2e10c185f6468d0b687e21c115988f88ba007469))
* **api:** email invitation links when SMTP is on ([d4b4dd1](https://github.com/jdoiron94/myli/commit/d4b4dd1d4d3acd40298f3ef860a0d9a577fa0a3e))
* **api:** enforce the permission policy with guards and an endpoint matrix ([473d301](https://github.com/jdoiron94/myli/commit/473d30189fde84b5f63f4810f6852a9365c68e3f))
* **api:** generate OpenAPI 3.1 contract from Zod with validation problems ([95e2e07](https://github.com/jdoiron94/myli/commit/95e2e07a27bec0dafb33c43f9da0d84e242cdc30))
* **api:** list, resend and revoke invitations; require JSON on writes ([984cd66](https://github.com/jdoiron94/myli/commit/984cd66c742749d25c10740d79b26ca7d2efbd1a))
* **api:** manage users' roles and deactivation, with lockout protection ([25def4b](https://github.com/jdoiron94/myli/commit/25def4b24c9abab2b3ba923125cc087721a19bc2))
* **api:** read secrets from files named by NAME_FILE ([f6ad960](https://github.com/jdoiron94/myli/commit/f6ad9607c14e9ea3a49aec31ef4314179ab54efd))
* **api:** return RFC 9457 problem details for errors ([2f34b89](https://github.com/jdoiron94/myli/commit/2f34b89bd25672b1d5b5c8a601e89f2e760870c5))
* **api:** trust X-Forwarded-For only from TRUSTED_PROXIES ([b3613c2](https://github.com/jdoiron94/myli/commit/b3613c2f31bcf64d4f3f1e52708814c6dbf7be4c))
* **api:** validate environment config with Zod ([cdffd75](https://github.com/jdoiron94/myli/commit/cdffd752b1fb754f720683c037744449e99b4366))
* run the stack with Docker Compose ([fe86966](https://github.com/jdoiron94/myli/commit/fe86966a28a80cf15634eb8e82781f925a586522))
* **shared:** add permission policy implementing the role matrix ([414f3ae](https://github.com/jdoiron94/myli/commit/414f3aefacb628918ecb266521e96f0a9023b5fe))
* **web:** add admin-only pages, session-end handling and the invitations list ([0d79eed](https://github.com/jdoiron94/myli/commit/0d79eed2aef6b84b4cbcdf7f9a05e6a1ffa12700))
* **web:** add sign-in, sign-out and session-aware routing ([205b172](https://github.com/jdoiron94/myli/commit/205b1721086a3c4e7b1614d358fb5c2f7e1b40c3))
* **web:** add Tailwind, shadcn-vue, the app layout and dark mode ([8c2d5d9](https://github.com/jdoiron94/myli/commit/8c2d5d9811ae1b36bbbf98d9a6527eff5b9802a2))
* **web:** add the accept-invitation page ([897a820](https://github.com/jdoiron94/myli/commit/897a82098f5f3f19985b2c5dde6d768ff8e01586))
* **web:** add the admin users page and pick up role changes ([ad6a00a](https://github.com/jdoiron94/myli/commit/ad6a00a5b8c3d443de1e1c329e7c676c585f8f51))
* **web:** add the first-run setup page ([0dc44d9](https://github.com/jdoiron94/myli/commit/0dc44d9d203a1b6af90658dfa9cd2af9803abb21))
* **web:** add the typed API client, problem errors and TanStack Query ([b519aad](https://github.com/jdoiron94/myli/commit/b519aad0a37afa337ac9733cb30efb90b59eec90))
* **web:** add the Vue app shell with routing, component tests and template formatting ([4f6e6a0](https://github.com/jdoiron94/myli/commit/4f6e6a00bd1d6b26bad60c414300878ef256a50e))
* **web:** add the web image with Caddy and a Content Security Policy ([b6c7ac8](https://github.com/jdoiron94/myli/commit/b6c7ac87215d2de1e46ea059f08c9e34de6d7221))
* **web:** invite, resend and revoke from the invitations page ([0f6d977](https://github.com/jdoiron94/myli/commit/0f6d97780cb90f9798ba91aff86d39dd1edfe22b))
* **web:** serve HTTPS at PUBLIC_URL with Caddy's local CA ([71da363](https://github.com/jdoiron94/myli/commit/71da3631378f6cd77a5f8d6fdadc8399576e69b3))
* **web:** serve the Scalar API docs as a separate page ([86a75d3](https://github.com/jdoiron94/myli/commit/86a75d3846293a207436a1bee009669690651e86))


### Bug Fixes

* **e2e:** allow the fragment Scalar adds to the API docs address ([b5d6163](https://github.com/jdoiron94/myli/commit/b5d6163f52c8e7cc415989260bdd15d96b688b10))
* **e2e:** let older Compose versions mount empty secrets ([576bf1d](https://github.com/jdoiron94/myli/commit/576bf1dd456caa17ef30eb83be46674802474f36))
* **e2e:** remove stacks an earlier run left behind ([5a95962](https://github.com/jdoiron94/myli/commit/5a959622da49ee955c09274460599829b500e731))
* **e2e:** run the image checks without a network ([d6b2c94](https://github.com/jdoiron94/myli/commit/d6b2c94e8d00fc2f9093eab56829e3f1e6cdddff))
