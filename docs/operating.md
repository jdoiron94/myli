# Running myli

This guide is for whoever runs myli for a household: installing and configuring it, trusting its certificate or putting it behind a proxy of yours, keeping photos in S3, backing it up and upgrading it. [Developing myli](development.md) covers working on its code.

## Install

myli runs with Docker Compose: Caddy serves it over HTTPS and passes `/api` to the API, next to Meilisearch for search. You need Docker with Docker Compose (tested with Compose 5.7), and an address for the server that the household's devices can reach, such as a name like `myli.home.arpa` set up in your router's DNS, or the server's IP address.

1. Clone this repository, and create `.env` from the example:

   ```sh
   cp .env.example .env
   ```

2. In `.env`, set at least:
   - `PUBLIC_URL`: `https://` and the server's address, like `https://myli.home.arpa`.
   - `BETTER_AUTH_SECRET` and `MEILI_MASTER_KEY`: generate each with `openssl rand -base64 32`.

   [Configuration](#configuration) explains every variable, as `.env.example` does. Leave the `_FILE` variables empty: Compose hands the secrets to the containers as files itself. Keep `ADMIN_PASSWORD`, `SMTP_PASSWORD` and `S3_SECRET_ACCESS_KEY` listed, even empty, or Compose won't start.

3. Build the images and start the stack. It's ready when `docker compose ps` shows every service healthy.

   ```sh
   docker compose up --detach --build
   ```

4. Open `PUBLIC_URL` and create the first admin. For an install where no one will open the setup screen, set `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` before starting instead: the admin is created at startup if no user exists yet. Empty `ADMIN_PASSWORD` once it has been.

   To try myli out instead, create demo accounts, one per role, and about twenty demo recipes, before anyone signs up. The script prints the accounts' passwords, once, and refuses on an instance that already has users:

   ```sh
   docker compose exec api node src/seed-demo.ts
   ```

Caddy takes ports 80 (which only redirects) and 443, on TCP and UDP. To use others, set `MYLI_HTTP_PORT` and `MYLI_HTTPS_PORT`, and put the HTTPS port in `PUBLIC_URL` too.

### Run a published release instead

Each release publishes both images to GitHub's container registry, privately: `ghcr.io/jdoiron94/myli-api` and `ghcr.io/jdoiron94/myli-web`, for linux/amd64. The [releases page](https://github.com/jdoiron94/myli/releases) lists each version and what changed.

1. Log Docker in to the registry once, with a GitHub personal access token (classic) that has only the `read:packages` scope:

   ```sh
   docker login ghcr.io --username <your GitHub username>
   ```

2. Set `MYLI_IMAGE_PREFIX=ghcr.io/jdoiron94/` and `MYLI_VERSION` to a release, like `0.1.0`, and start the stack without `--build`:

   ```sh
   docker compose up --detach
   ```

Then all you need is `compose.yaml` and the variables, which a Compose management tool can hold in place of `.env`, with the token as its credentials for `ghcr.io`.

To move to a newer release, see [Upgrade](#upgrade).

## Configuration

myli reads its settings from environment variables. Compose takes them from `.env` beside `compose.yaml`, or from a Compose management tool that holds them in its place. An empty value counts as unset. While one is missing or invalid, the API won't start, and its log names each. [`.env.example`](../.env.example) lists them all, with their defaults, as do the tables below.

**Secrets** (`BETTER_AUTH_SECRET`, `MEILI_MASTER_KEY`, `ADMIN_PASSWORD`, `SMTP_PASSWORD` and `S3_SECRET_ACCESS_KEY`) reach the API as files. Compose hands each to the container as a secret, and points the API at it with the variable's `_FILE` twin, such as `BETTER_AUTH_SECRET_FILE`. Leave those empty in `.env`. Outside Compose, set either a secret or its `_FILE` variable, never both. Keep `ADMIN_PASSWORD`, `SMTP_PASSWORD` and `S3_SECRET_ACCESS_KEY` listed, even empty, or Compose won't start.

### Required

| Variable | Default | What it's for |
|---|---|---|
| `PUBLIC_URL` | required | The address people open myli at: `https://` and the server's name or address, with a port only if it isn't 443, like `https://myli.home.arpa`. Caddy serves it, sign-in only accepts requests from it, and emailed links point to it. |
| `BETTER_AUTH_SECRET` | required | Signs session cookies. At least 32 characters: `openssl rand -base64 32`. Changing it signs everyone out. |
| `MEILI_MASTER_KEY` | required | Meilisearch's master key, which Compose starts it with. At least 16 characters: `openssl rand -base64 32`. The API uses it only as it starts, to make a key of its own. |

### The first admin

Set all three to create the first admin as the API starts, if no user exists yet, for an install where no one opens the setup screen. Users who exist already are never changed.

| Variable | Default | What it's for |
|---|---|---|
| `ADMIN_NAME` | none | Their name. |
| `ADMIN_EMAIL` | none | Their email address, which they sign in with. |
| `ADMIN_PASSWORD` | none | 15 to 128 characters, with a lowercase letter, an uppercase letter, a number and a special character. Empty it once the admin exists. |

### Email

Email is off unless `SMTP_HOST` is set. Without it, admins copy invitation links and pass them on however they like.

| Variable | Default | What it's for |
|---|---|---|
| `SMTP_HOST` | none | The SMTP server's host name or IP address. |
| `SMTP_PORT` | 587, 465 or 25 | The server's port. By default, the one `SMTP_SECURITY` usually takes. |
| `SMTP_SECURITY` | `starttls` | How the connection is encrypted. `starttls` upgrades to TLS once connected, and refuses to send if the server can't (port 587). `tls` is TLS from the first byte (port 465). `none` is no encryption, for a relay on the same machine (port 25). Server certificates are always verified. |
| `SMTP_USER` | none | The login, if the server needs one. Set both or neither. |
| `SMTP_PASSWORD` | none | Its password. |
| `SMTP_FROM` | none | The sender, required with `SMTP_HOST`: an address, optionally with a name, like `myli <myli@example.com>`. |

### Photos

| Variable | Default | What it's for |
|---|---|---|
| `BLOB_STORE` | `local` | Where photos are kept: `local`, in the `api-data` volume, or `s3`, in a bucket ([Keep photos in S3](#keep-photos-in-s3)). |
| `S3_ENDPOINT` | none | With `s3`, the store's address, like `http://garage:3900`. Empty for AWS. |
| `S3_REGION` | `us-east-1` | The region requests are signed for. |
| `S3_BUCKET` | none | Required with `s3`: the bucket, which must exist already. |
| `S3_ACCESS_KEY_ID` | none | Required with `s3`: the key, allowed to read, write and delete objects in the bucket. |
| `S3_SECRET_ACCESS_KEY` | none | Required with `s3`: the key's secret. |

### Upkeep

| Variable | Default | What it's for |
|---|---|---|
| `BACKUP_KEEP` | `7` | How many nightly backups are kept, from 0 to 365. 0 turns them off ([Back up and restore](#back-up-and-restore)). |
| `TRASH_RETENTION_DAYS` | `30` | Days a deleted recipe stays in the trash before it's deleted for good, with its history and photos, from 1 to 365. Lowering it purges what's now past it straight away. |
| `INVITATION_TTL_DAYS` | `7` | Days an invitation link works, from 1 to 90. |
| `LOG_LEVEL` | `info` | The least the API logs: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |

### Compose

Only Compose reads these. Its own variables work in `.env` too, such as `COMPOSE_PROFILES=s3`.

| Variable | Default | What it's for |
|---|---|---|
| `MYLI_IMAGE_PREFIX` | none | Where the images come from: a registry, ending in a slash, like `ghcr.io/jdoiron94/` for the published releases. Empty for the images `docker compose up --build` builds here. |
| `MYLI_VERSION` | `latest` | The images' version, like `0.17.0`. |
| `MYLI_HTTP_PORT` | `80` | The host's port for HTTP, which only redirects to HTTPS. |
| `MYLI_HTTPS_PORT` | `443` | The host's port for HTTPS, which must be `PUBLIC_URL`'s. |
| `MYLI_PROXY_SUBNET` | `10.89.0.0/29` | The network Caddy and the API share. The API believes what addresses in it say about who the client is. Change it if it clashes with a network on the host. |
| `MYLI_GARAGE_RPC_SECRET` | none | With the `s3` profile, the secret Garage's nodes share: `openssl rand -hex 32`. |
| `MYLI_GARAGE_ADMIN_TOKEN` | none | With the `s3` profile, the token for Garage's admin API: `openssl rand -base64 32`. |

### Set by the image

The API's image and `compose.yaml` set these, so their values in `.env` are ignored there. The defaults apply where the API runs on its own, as in development.

| Variable | Default | What it's for |
|---|---|---|
| `NODE_ENV` | `production` | The runtime mode: `development`, `test` or `production`. |
| `HOST` | `0.0.0.0` | The address the API listens on. |
| `PORT` | `3000` | The port it listens on. |
| `DATABASE_PATH` | `./data/myli.db` | The SQLite database, created on first start. `/data/myli.db` in the image, on the `api-data` volume. |
| `BLOB_DIR` | `./data/blobs` | Photos, with `BLOB_STORE=local`. `/data/blobs` in the image. |
| `BACKUP_DIR` | none | Backups: a `backups` directory next to the database unless set. `/backups` in the image, on the `backups` volume. |
| `MEILI_URL` | `http://localhost:7700` | Meilisearch. `http://meilisearch:7700` in Compose. |
| `TRUSTED_PROXIES` | none | The proxies allowed to say who the client is, in `X-Forwarded-For`: addresses or ranges, comma-separated. `MYLI_PROXY_SUBNET` in Compose. |

## Trust myli's certificate on each device

Caddy has its own certificate authority, created in its `caddy-data` volume on first start ([ADR 0013](adr/0013-https-with-caddys-local-ca.md)). Until a device trusts its root certificate, browsers warn about the connection, and cook mode can't keep the screen on. Each device trusts it once.

Copy the root certificate out, and note its fingerprint:

```sh
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt myli-root.crt
openssl x509 -in myli-root.crt -noout -fingerprint -sha256
```

Get `myli-root.crt` onto each device in a way you trust, such as AirDrop, a cable or a message to yourself. Where the device shows the fingerprint, check that it matches before trusting it.

- **iPhone and iPad:** open the file, then install the profile in Settings → General → VPN & Device Management. Then turn on full trust for "Caddy Local Authority" in Settings → General → About → Certificate Trust Settings.
- **Android:** Settings → Security → Encryption & credentials → Install a certificate → CA certificate. The menus vary by maker. Firefox for Android also needs its "Use third party CA certificates" setting.
- **macOS:** `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain myli-root.crt`
- **Windows:** in a terminal run as administrator, `certutil -addstore -f Root myli-root.crt`
- **Linux:** on Debian and Ubuntu, `sudo cp myli-root.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates`. Firefox and Chrome on Linux keep their own lists: import the file in their certificate settings, as an authority that identifies websites.

Behind a proxy of your own whose certificate devices trust already, they needn't trust this one: see [Behind another reverse proxy](#behind-another-reverse-proxy).

A device that trusts this certificate trusts it for every site, not only myli. Whoever has the `caddy-data` volume could pretend to be any site to that device, so guard the volume like the server's other secrets.

## Behind another reverse proxy

myli's Caddy serves HTTPS itself, so myli needs no other proxy. If you run one already, for other services or for a certificate every device trusts without being told, such as Let's Encrypt's, it can pass myli's requests on to Caddy:

- `PUBLIC_URL` is the address people open, at your proxy.
- Your proxy connects to Caddy's HTTPS port (its HTTP port only redirects), with `PUBLIC_URL`'s host name both in the TLS handshake (SNI) and in the `Host` header: Caddy serves that name alone. Caddy's certificate is from its own authority, so have the proxy skip verifying it, or trust Caddy's root certificate. With a certificate of the proxy's own that devices trust, they needn't trust Caddy's.
- It lets request bodies through up to 10 MB, the largest photo myli takes.
- It passes responses on as they come, for the instance's export, which is made as it downloads.
- It keeps paths under `/p/` and `/api/v1/public/` out of its logs. A recipe's public link holds its secret in its address, as `https://myli.home.arpa/p/<token>` ([ADR 0016](adr/0016-public-link-token-in-the-path.md)), and anyone who reads those logs could open the recipes. myli itself never logs it, nor sends it to other sites.

For a proxy on the same machine, publish Caddy on the loopback address only, at a port of its own, in a `compose.override.yaml` beside `compose.yaml`:

```yaml
services:
  caddy:
    ports: !override
      - 127.0.0.1:8443:443   # 443 is PUBLIC_URL's port, which Caddy listens on inside
```

With nginx, for `PUBLIC_URL=https://myli.example.com`:

```nginx
# Public links hold their secret in their path.
map $request_uri $myli_loggable {
    ~^/(p|api/v1/public)/ 0;
    default 1;
}

server {
    listen 443 ssl;
    http2 on;
    server_name myli.example.com;
    ssl_certificate     /etc/letsencrypt/live/myli.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myli.example.com/privkey.pem;

    access_log /var/log/nginx/access.log combined if=$myli_loggable;
    client_max_body_size 10m;

    location / {
        proxy_pass https://127.0.0.1:8443;
        proxy_set_header Host $http_host;
        proxy_ssl_server_name on;
        proxy_ssl_name $host;
        # The instance's export, as it's made.
        proxy_buffering off;
        # Caddy offers HTTP/3 on its own port, which browsers can't reach.
        proxy_hide_header Alt-Svc;
    }
}
```

nginx's error log can still name a request's path when it can't reach myli, so keep it private.

One thing doesn't work behind another proxy yet: myli's Caddy trusts no proxy in front of it to say who the client is. Every request seems to come from your proxy, or, from one on the same machine, from the Docker network Caddy is on. So the audit log records that one address for everyone, and sign-in's rate limiting counts the whole household's attempts together.

## Keep photos in S3

Photos are kept in the `api-data` volume unless you choose an S3 bucket instead: on AWS, or any store that speaks its API. Set, in `.env`:

```sh
BLOB_STORE=s3
S3_ENDPOINT=https://s3.example.com   # empty for AWS
S3_REGION=us-east-1                  # the region requests are signed for
S3_BUCKET=myli-photos
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

The bucket must exist, and its key must be allowed to read, write and delete objects in it. Nothing in it needs to be public: the API serves every photo itself, to whoever may see its recipe. myli puts the bucket's name in the path, as `https://s3.example.com/myli-photos/images/…`, not in the host name, so any store that speaks S3 can serve it.

### With Garage, on the same machine

Compose's `s3` profile runs [Garage](https://garagehq.deuxfleurs.fr/), a store that speaks S3, next to the API, where only the API can reach it. Before the API starts, it sets Garage up: the bucket, and the API's key, allowed only to read, write and delete photos in it.

1. In `.env`, set:

   ```sh
   COMPOSE_PROFILES=s3                  # so every docker compose command includes Garage
   BLOB_STORE=s3
   S3_ENDPOINT=http://garage:3900
   S3_BUCKET=myli
   S3_ACCESS_KEY_ID=GK...               # echo "GK$(openssl rand -hex 12)"
   S3_SECRET_ACCESS_KEY=...             # openssl rand -hex 32
   MYLI_GARAGE_RPC_SECRET=...           # openssl rand -hex 32
   MYLI_GARAGE_ADMIN_TOKEN=...          # openssl rand -base64 32
   ```

2. Start the stack as usual. `docker compose ps --all` shows `garage-init` exited with code 0 once Garage is ready, and the API's log says `photos are kept in an S3 bucket`.

Garage keeps the photos in the `garage-data` volume. It can't change a key's secret: to change `S3_SECRET_ACCESS_KEY`, choose a new `S3_ACCESS_KEY_ID` too.

### Switch with photos already uploaded

The photos uploaded so far stay where they were kept until they're copied into the new store:

1. Stop the API, so no photo is uploaded meanwhile:

   ```sh
   docker compose stop api
   ```

2. Change `BLOB_STORE` and the S3 variables in `.env`, as above.
3. Copy the photos into the new store from the old one. With Garage, this starts it and sets it up first. It says how many it copied, and can run again, leaving what it copied already:

   ```sh
   docker compose run --rm api node src/copy-photos.ts
   ```

4. Start the stack again: `docker compose up --detach`.

Nothing is deleted from the old store: once the photos show, free its space yourself. Going back to the `api-data` volume works the same way, with `BLOB_STORE=local`, and the S3 variables still set while the photos are copied from the bucket.

## Back up and restore

myli backs itself up every night at 03:30, server time, and when the API starts if its last backup is more than a day old. Each backup is one zip file: the database, copied as it was at one moment, and every photo it names, when they're kept in the `api-data` volume. Photos kept in an S3 bucket are left out, to the bucket's own safeguards, such as versioning or replication on AWS. The API's log says `backup saved` for each, with its size.

The newest 7 are kept in the `backups` volume. Set `BACKUP_KEEP` in `.env` to keep more or fewer, or to 0 to turn backups off. Each is a full copy, so seven take about seven times the space of the photos they hold.

That volume is on the same disk as everything else. To keep backups on another, mount a directory from it at `/backups` instead, in a `compose.override.yaml` beside `compose.yaml`, and make it writable by uid 1000, the API's user (`sudo chown 1000:1000 /mnt/backups/myli`):

```yaml
services:
  api:
    volumes:
      - /mnt/backups/myli:/backups
```

Copy them off the machine too, with whatever you use for other files.

To back up now, before an upgrade for one, while the stack runs:

```sh
docker compose exec api node src/backup-now.ts
```

It says where it saved the backup, which counts among the 7 kept.

To restore one, stop the API, so nothing changes meanwhile, and give the backup's name. Without one, the command lists the backups, newest first:

```sh
docker compose stop api
docker compose run --rm api node src/restore-backup.ts myli-backup-2026-11-26T033000Z.zip
docker compose start api
```

It checks the backup before it changes anything, then puts any photos it holds in the store `BLOB_STORE` names, and its database in place. The database it replaces is kept beside it, renamed `myli.db.before-restore-<time>`, until you delete it. Photos uploaded since the backup stay in the store, unseen. The API rebuilds the search index as it starts. Everyone is signed out who signed in since the backup, and every change since is gone. Restore with the version of myli that made the backup, or a newer one: an older one doesn't know a newer database.

A backup taken while photos were kept in S3 holds none: restore it with the same S3 settings, and the restored database finds them in the bucket. Photos deleted from the bucket since the backup, such as those of recipes purged from the trash meanwhile, stay gone unless the bucket keeps old versions.

To move myli to another machine, set it up there as in [Install](#install), with the same `.env`, and before you start it, restore a backup from the directory you copied it to:

```sh
docker compose run --rm -v "$PWD:/restore:ro" api node src/restore-backup.ts /restore/myli-backup-2026-11-26T033000Z.zip
```

Compose keeps the rest of myli's data in volumes, named after the project (`myli` unless you choose another):

| Volume | Contents |
|---|---|
| `myli_api-data` | The database and the photos, all of which the backups hold. With `BLOB_STORE=s3`, the photos are in the bucket instead, which the backups leave out. |
| `myli_backups` | The backups. |
| `myli_caddy-data` | The certificate authority, which the backups don't hold. Without it, Caddy creates a new one, which every device has to trust again. Browsers that have seen myli won't let anyone click past the warning until then. |
| `myli_garage-data` | With Garage (the `s3` profile), the photos, which the backups don't hold. It's their only copy: archive it as Caddy's below, with the stack stopped (`docker compose stop`), or keep it on a disk that's backed up. |
| `myli_meilisearch-data` | The search index, which is rebuilt from the database. No need to back it up: an empty index is rebuilt when the API starts. |

Caddy's certificate authority doesn't change once it's created, so archive its volume once:

```sh
docker run --rm -v myli_caddy-data:/data:ro -v "$PWD:/backup" alpine \
  tar -czf /backup/myli-caddy-data.tar.gz -C /data .
```

## Upgrade

Each release's notes, on the [releases page](https://github.com/jdoiron94/myli/releases) and in [`CHANGELOG.md`](../CHANGELOG.md), say what changed. Read those of every release since yours: whatever a release needs you to do is under **⚠ BREAKING CHANGES**, and the notes below cover older releases. You can skip releases: the API brings the database up to date in one go.

1. Back up, while the stack runs:

   ```sh
   docker compose exec api node src/backup-now.ts
   ```

2. Move to the new release:
   - **With published images,** set `MYLI_VERSION` to it, and take its `compose.yaml` from its tag in this repository, or paste it into your Compose management tool. Then pull the images and start the stack:

     ```sh
     docker compose pull
     docker compose up --detach
     ```

   - **With images built here,** check out its tag and rebuild:

     ```sh
     git fetch --tags && git checkout v0.17.0
     docker compose up --detach --build
     ```

3. The API applies the database's migrations as it starts. It's done when `docker compose ps` shows every service healthy, and `docker compose logs api` shows no errors.

To go back to the release you came from, restore the backup from step 1 with that release: the newer one may have changed the database in ways the older one doesn't know. Everything changed since the backup is lost. Stop the API, set `MYLI_VERSION` back (or check out the older tag and run `docker compose build`), restore, and start the stack:

```sh
docker compose stop api
docker compose run --rm api node src/restore-backup.ts myli-backup-2026-11-26T033000Z.zip
docker compose up --detach
```

### Upgrading from older releases

- **From before 0.17.0,** which had no backups: instead of step 1, stop the stack and archive the `api-data` volume, then go on with step 2. The new `compose.yaml` adds the `backups` volume, and the API backs up as it starts.

  ```sh
  docker compose stop
  docker run --rm -v myli_api-data:/data:ro -v "$PWD:/backup" alpine \
    tar -czf /backup/myli-api-data.tar.gz -C /data .
  ```

- **From before 0.16.0:** list `S3_SECRET_ACCESS_KEY` in `.env`, even empty, or Compose won't start.

## Rebuild the search index

The search index is kept in step with the database as recipes change, and rebuilt by itself when it's found empty. Should search ever miss a recipe, rebuild it while the stack runs. Search keeps working meanwhile:

```sh
docker compose exec api node src/reindex-search.ts
```
