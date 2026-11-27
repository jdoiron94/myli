# Running myli

This guide is for whoever runs myli for a household: installing it, trusting its certificate, keeping photos in S3, and backing it up. [Developing myli](development.md) covers working on its code.

## Install

myli runs with Docker Compose: Caddy serves it over HTTPS and passes `/api` to the API, next to Meilisearch for search. You need Docker with Docker Compose (tested with Compose 5.7), and an address for the server that the household's devices can reach, such as a name like `myli.home.arpa` set up in your router's DNS, or the server's IP address.

1. Clone this repository, and create `.env` from the example:

   ```sh
   cp .env.example .env
   ```

2. In `.env`, set at least:
   - `PUBLIC_URL`: `https://` and the server's address, like `https://myli.home.arpa`.
   - `BETTER_AUTH_SECRET` and `MEILI_MASTER_KEY`: generate each with `openssl rand -base64 32`.

   [`.env.example`](../.env.example) explains every variable. Leave the `_FILE` variables empty: Compose hands the secrets to the containers as files itself. Keep `ADMIN_PASSWORD`, `SMTP_PASSWORD` and `S3_SECRET_ACCESS_KEY` listed, even empty, or Compose won't start.

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

To upgrade, back up first (`docker compose exec api node src/backup-now.ts`, below), set `MYLI_VERSION` to the new release, and run `docker compose up --detach` again. The API applies any database migrations as it starts.

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

A device that trusts this certificate trusts it for every site, not only myli. Whoever has the `caddy-data` volume could pretend to be any site to that device, so guard the volume like the server's other secrets.

## Public links

A recipe's public link holds its secret in its address, as `https://myli.home.arpa/p/<token>` ([ADR 0016](adr/0016-public-link-token-in-the-path.md)). myli never logs it, nor sends it to other sites. If you put a proxy of your own in front of myli, keep it from logging paths under `/p/` and `/api/v1/public/`: anyone who reads those logs could open the recipes.

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

## Rebuild the search index

The search index is kept in step with the database as recipes change, and rebuilt by itself when it's found empty. Should search ever miss a recipe, rebuild it while the stack runs. Search keeps working meanwhile:

```sh
docker compose exec api node src/reindex-search.ts
```
