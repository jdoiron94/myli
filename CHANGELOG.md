# Changelog

## [0.2.0](https://github.com/jdoiron94/myli/compare/v0.1.0...v0.2.0) (2026-11-17)


### Features

* **api:** add the recipe, ingredient, step and tag tables, with the allergens seeded ([40ec3c1](https://github.com/jdoiron94/myli/commit/40ec3c1e67879780dce3068f5c55c1fb7bbecbb2))
* **api:** create and read recipes ([6f7ecf4](https://github.com/jdoiron94/myli/commit/6f7ecf42b9682a993c3928d3f53c560329c5444d))
* **api:** delete recipes, softly, with an audit event ([9f507b8](https://github.com/jdoiron94/myli/commit/9f507b82ad23301dd643486fc3ca0c78e0549005))
* **api:** list tags, and let editors create them ([d2f1d0d](https://github.com/jdoiron94/myli/commit/d2f1d0d69c42e6ec74fc411f4f6f67a6b73d482e))
* **api:** save each user's unit system ([eaaeb9e](https://github.com/jdoiron94/myli/commit/eaaeb9e3401e6c8ca8e56b20f23bac7bef49601e))
* **api:** save recipes, and let owners change their visibility ([0a6baa6](https://github.com/jdoiron94/myli/commit/0a6baa69d11efb23009a866860f05e2d3060b12f))
* **shared:** add units of measure and conversion ([9ef8450](https://github.com/jdoiron94/myli/commit/9ef84505241e68b326b7e7f6c1f992c4a42cc478))
* **shared:** parse ingredient lines and normalize their names ([910105d](https://github.com/jdoiron94/myli/commit/910105d71e068da801ebccf653e90731ae17e2ef))
* **shared:** scale ingredient amounts and show them as cooks write them ([6886fc4](https://github.com/jdoiron94/myli/commit/6886fc4cef1cfdfe00f744f31064d9f6f8723193))
* **web:** a calmer layout for the recipe page ([865661b](https://github.com/jdoiron94/myli/commit/865661b5b625eb0e50fc8acf0ff79f5b00d817de))
* **web:** choose servings and units on one row ([893aa0f](https://github.com/jdoiron94/myli/commit/893aa0fd39bff5ce8962ea6dd1c0813d485b54ec))
* **web:** correct how an ingredient line is read ([08f84d0](https://github.com/jdoiron94/myli/commit/08f84d0616442a3e043a500998783de6d81f45b4))
* **web:** create and edit a recipe's details ([ace704f](https://github.com/jdoiron94/myli/commit/ace704f92dfe103478055544f49c821723af2990))
* **web:** edit a recipe's ingredients, seeing how each line is read ([76a7a29](https://github.com/jdoiron94/myli/commit/76a7a29a7047690842806f521b67408af517c12b))
* **web:** mark a recipe's actions with icons ([e9e8cab](https://github.com/jdoiron94/myli/commit/e9e8cab802571e3b5fd6fdd2696c6a2eb7aee5ca))
* **web:** mark the header's links with icons ([ed0d97b](https://github.com/jdoiron94/myli/commit/ed0d97b59aa48698da50a1faf08e6873560830e3))
* **web:** render user-written markdown safely ([eb1b189](https://github.com/jdoiron94/myli/commit/eb1b18924eed830995d187235f855f0b3bf66605))
* **web:** scale a recipe, and show it in the reader's units ([d1ae22d](https://github.com/jdoiron94/myli/commit/d1ae22defbe7873fb66fe3895aee8791960a01d8))
* **web:** share, make private and delete a recipe from its page ([8cb893e](https://github.com/jdoiron94/myli/commit/8cb893e3dd4f83d3db61ccfc4a980c7bdf642da4))
* **web:** show a recipe on its own page ([6c265a2](https://github.com/jdoiron94/myli/commit/6c265a2a14fade17423b2225542f2f516071e1e7))
* **web:** show a recipe's tags in one row, and its allergens after its ingredients ([221100b](https://github.com/jdoiron94/myli/commit/221100bb1a203ea95deac36af513692297494d13))
* **web:** show what a recipe contains first among its tags ([de158d6](https://github.com/jdoiron94/myli/commit/de158d670331f8cb299d62ead50860dcfdf4a0f3))
* **web:** tag a recipe, adding new tags from the editor ([1aece53](https://github.com/jdoiron94/myli/commit/1aece532b7dc308cd97a3189b0bb29fc25be5097))
* **web:** write a recipe's description in the markdown editor ([39901ed](https://github.com/jdoiron94/myli/commit/39901edbf0a42632675bc976e9a089ce12911187))
* **web:** write a recipe's steps, adding, moving and removing them ([fc759ae](https://github.com/jdoiron94/myli/commit/fc759aefeb710d92d9e31024395ca49713f8ff8c))


### Bug Fixes

* **web:** keep user markdown to ADR 0006's subset ([4b0f76e](https://github.com/jdoiron94/myli/commit/4b0f76ecd9b9cae398256ff711a4678c021623cf))
* **web:** say where a recipe is from with only its author given ([78e3807](https://github.com/jdoiron94/myli/commit/78e3807502f194ccbb3deb2e49079b79c9f8cf9c))
* **web:** show the pointer over everything that can be clicked ([fd9dab3](https://github.com/jdoiron94/myli/commit/fd9dab31c64c13e8d326800eeaaeb2b3d9f8a68d))

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
