# archie-chatbot — VPS deploy runbook

Self-hosted on Contabo VPS at `archie-chatbot.lieuwejongsma.nl`. Replaces Fly.io
app `archie-chatbot` and `archie-redis` (Redis dropped; SQLite session store
fallback in `server/middleware/sessionStoreFactory.js` is used instead).

## Port layout

| Layer | Address |
|---|---|
| Container internal | `:4008` |
| Host bind | `127.0.0.1:3004` |
| Caddy public | `archie-chatbot.lieuwejongsma.nl:443` |

## One-time VPS prep

```bash
ssh lieuwe@vmi3314129
sudo mkdir -p /srv/apps/archie-chatbot /srv/data/archie-chatbot
sudo chown -R lieuwe:lieuwe /srv/apps/archie-chatbot /srv/data/archie-chatbot
```

Copy `docker-compose.yml` from this repo to `/srv/apps/archie-chatbot/`.

Create `/srv/apps/archie-chatbot/.env` from `deploy/env.example`. Fill secrets:

```bash
chmod 600 /srv/apps/archie-chatbot/.env
```

Add Caddy block:

```bash
sudo cp deploy/archie-chatbot.caddyfile /etc/caddy/sites.d/archie-chatbot.caddyfile
sudo systemctl reload caddy
```

## DNS

Metaregistrar: add `A 84.247.137.239` + `AAAA 2a02:c207:2331:4129::1` for
`archie-chatbot.lieuwejongsma.nl`. Wait for propagation (typically <5 min)
before reloading Caddy — Let's Encrypt provisioning needs the record.

## Repo secrets (per-repo, not org-wide)

```bash
gh secret set VPS_HOST   -R lieuwe89/archie-chatbot -b "84.247.137.239"
gh secret set VPS_USER   -R lieuwe89/archie-chatbot -b "lieuwe"
gh secret set VPS_SSH_KEY -R lieuwe89/archie-chatbot < ~/.ssh/id_bhv_deploy
```

## Data migration from Fly

Two separate per-machine 1 GB volumes on Fly — inspect both first to pick the
canonical source (or merge). `flyctl ssh console -C` corrupts binary tar
streams: use sftp two-step (Phase 3 lesson 1).

```bash
# Inspect both machines
flyctl machine list -a archie-chatbot
flyctl ssh console -s 0805122c5e24d8 -a archie-chatbot -C "sh -c 'ls -la /data && du -sh /data/*'"
flyctl ssh console -s 286ed93a972048 -a archie-chatbot -C "sh -c 'ls -la /data && du -sh /data/*'"

# Pick the canonical machine, tar in place
flyctl ssh console -s <MACHINE_ID> -a archie-chatbot \
  -C "sh -c 'cd /data && tar --exclude=*.backup* --exclude=._* -cf data.tar .'"

# sftp pull (binary-clean)
flyctl ssh sftp get -a archie-chatbot /data/data.tar /tmp/archie-data.tar

# Push to VPS
scp /tmp/archie-data.tar lieuwe@vmi3314129:/srv/data/archie-chatbot/

# Unpack on VPS
ssh lieuwe@vmi3314129 'cd /srv/data/archie-chatbot && tar -xf archie-data.tar && rm archie-data.tar'

# Clean Fly intermediate
flyctl ssh console -s <MACHINE_ID> -a archie-chatbot -C "rm /data/data.tar"
```

## First deploy

Push to `main` triggers `.github/workflows/deploy-vps.yml`. After it lands:

```bash
curl -sI https://archie-chatbot.lieuwejongsma.nl/api/auth/status
# Expect HTTP/2 200, content-type application/json
```

Browser UAT: login at `https://archie-chatbot.lieuwejongsma.nl/`, send a chat
message, hit `/admin`, upload a small test doc.

## Gallery cutover

In `playground-gallery/`:

- `index.html` — bump the archie link to `https://archie-chatbot.lieuwejongsma.nl/`.
- `archie/index.php` — delete.
- `archie/.htaccess` — replace contents with:
  ```
  RewriteEngine On
  RewriteRule ^(.*)$ https://archie-chatbot.lieuwejongsma.nl/$1 [R=301,L]
  ```
- Bump `VERSION` and commit.

## Fly decommission (after 1 week parallel)

```bash
flyctl apps destroy archie-chatbot
flyctl apps destroy archie-redis
```

Delete `fly.toml`, `.github/workflows/deploy.yml`, `archie-redis-fly/` subdir.
Remove `FLY_API_TOKEN` repo secret if no other workflow uses it.
