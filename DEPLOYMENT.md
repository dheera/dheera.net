# Production: static Nginx on EC2

Production uses the existing EC2 IP and registrar/DNS configuration. Nginx serves complete static releases; no Node process, PM2, Forever, application database, or build tooling is needed on the server. Optional regional visibility uses a local MaxMind GeoLite2 database file.

## Publish

Run from the repository root after editing the NAS content or theme (`npm run deploy:production` remains an alias):

```sh
npm run deploy -- --dry-run
npm run deploy
```

The command builds with the production URL in `deployment/ec2.json`, inventories only public output, uploads a new release with rsync, verifies every file's SHA-256 on the server, and atomically replaces `/var/www/dheera.net/current`. There is no Nginx restart during ordinary publication. HTML, styles and scripts use a 60-second cache lifetime, except `/visibility.css`, which uses `private, no-store`. Old releases are retained for rollback; remove old releases manually only after confirming they are not active or needed.

`--dry-run` builds and checks locally without contacting or changing the server. A failed build/upload/checksum check leaves the active symlink unchanged. Local deployment receipts live in ignored `.published/deployments/production/current.json` and include the previous release target.

The SSH key is read from `--identity /path/to/key`, then `DHEERA_SSH_KEY`, then `~/private/aws/aws-us-west.pem`. It is never copied to the repository or server. SSH uses existing host-key verification and noninteractive authentication. `deployment/ec2.json` contains only public host/origin/path configuration. Local dependencies are Node 22.12+, OpenSSH, rsync and the normal npm packages; the server needs Nginx, rsync and Python 3.

Publication excludes the private build manifest, NAS originals, content sidecars, dependencies and credentials. The release validator rejects hidden files, symlinks, unknown files and design-preview controls. Uploaded releases must contain exactly the inventoried files before activation.

## Initial server setup

The deployment user needs write access to the release directory and `current` symlink, but not to Nginx configuration or TLS keys:

```sh
sudo install -d -o ubuntu -g ubuntu -m 755 /var/www/dheera.net
sudo install -d -o ubuntu -g ubuntu -m 755 /var/www/dheera.net/releases
```

Back up the existing Nginx configuration and application supervisor state first. Complete the regional-visibility setup below before installing the reviewed `deployment/nginx.conf` as the site's enabled virtual host; the vhost references its GeoIP map. Retain the existing certificate and key at their server-only paths. Publish a release before switching the virtual host to the static root. Test with `sudo nginx -t`, reload Nginx, and verify HTTP redirects, HTTPS, clean gallery URLs, both languages, media and real 404 responses. Stop and disable only the retired website's Node supervisor after the static site works. Nginx should be enabled and running under systemd.

Real downloads are kept in `public/files/` and included in every static release. The vhost preserves the résumé/profile-code redirects to these same-site files and legacy aliases for the galleries migrated to this site. Old posts and galleries not included in the new library return 404. It does not use an SPA fallback. Do not put private source or credentials under the document root.

## Regional visibility

The same HTML is published for everyone. Nginx looks up the connecting IP in a local GeoLite2 City database and serves either `/assets/visibility-normal.css` or `/assets/visibility-limited.css` at the same `/visibility.css` URL. There is no browser location permission or third-party lookup for each visit. New Jersey (`US:NJ`) and Tamil Nadu (`IN:TN`) receive the limited stylesheet; unlisted or unknown locations receive the normal stylesheet. The limited view hides the About page content and links to About. Home introductions, gallery descriptions and photo captions remain visible.

This only reduces casual discovery. Hidden content remains in the page source and can be revealed by disabling CSS. An IP's location may be inaccurate, and a VPN may appear elsewhere. Direct visitors are identified using `$remote_addr`; request headers, cookies and query parameters cannot select a region. If a reverse proxy is added later, configure its trusted addresses deliberately before relying on forwarded client IPs.

Presentation lives in the theme's visibility CSS assets. The server configuration only chooses the asset, so CSS changes go through the normal publish command. The region list is separate in `deployment/visibility-regions.map`; changing it requires installing the updated file on the server, testing Nginx, and reloading it. The `/visibility.css` endpoint sends one `Cache-Control: private, no-store` header and disables conditional 304 responses so a previous variant cannot be reused after a visitor's IP changes. Other static assets and pages keep their usual cache policy.

### One-time server setup

Run these steps on the server after copying the reviewed `deployment/` files there. Keep the existing site configuration active until the database and both stylesheet assets are available. On Ubuntu, install the packaged GeoIP2 module and updater:

```sh
sudo apt-get install libnginx-mod-http-geoip2 geoipupdate
sudo install -d -o root -g root -m 755 /var/lib/GeoIP
sudo touch /etc/GeoIP.conf
sudo chown root:root /etc/GeoIP.conf
sudo chmod 600 /etc/GeoIP.conf
sudoedit /etc/GeoIP.conf
```

Put the MaxMind numeric account ID and license key in that server-only file, replacing these placeholders. Do not add this file, database downloads or credentials to Git or the site output:

```text
AccountID YOUR_NUMERIC_ACCOUNT_ID
LicenseKey YOUR_LICENSE_KEY
EditionIDs GeoLite2-City
DatabaseDirectory /var/lib/GeoIP
```

The Ubuntu module package enables its dynamic-module loader; do not add a duplicate `load_module` line. Install the updater unit, make the first download, and then enable its timer:

```sh
sudo install -o root -g root -m 644 deployment/geoipupdate.service /etc/systemd/system/dheera-geoipupdate.service
sudo install -o root -g root -m 644 deployment/geoipupdate.timer /etc/systemd/system/dheera-geoipupdate.timer
sudo systemctl daemon-reload
sudo systemctl start dheera-geoipupdate.service
sudo test -s /var/lib/GeoIP/GeoLite2-City.mmdb
sudo systemctl enable --now dheera-geoipupdate.timer
```

Ubuntu 20.04 also installs a weekly cron job. Disable that duplicate schedule (the dot in the diverted filename makes cron ignore it):

```sh
sudo dpkg-divert --local --rename --add --divert /etc/cron.d/geoipupdate.disabled /etc/cron.d/geoipupdate
```

The service reads `/etc/GeoIP.conf` as root and makes only the database world-readable for Nginx workers. Its daily timer has up to an hour of randomized delay and catches up after downtime. MaxMind's updater checks whether a new database is available before downloading it. Outbound DNS and HTTPS must work, including redirects to MaxMind's download storage. See [MaxMind's updater documentation](https://github.com/maxmind/geoipupdate/blob/main/doc/geoipupdate.md) and [database update guidance](https://dev.maxmind.com/geoip/updating-databases/).

Once the database exists, install the HTTP-context configuration and region list:

```sh
sudo install -o root -g root -m 644 deployment/nginx-geoip.conf /etc/nginx/conf.d/dheera-geoip.conf
sudo install -o root -g root -m 644 deployment/visibility-regions.map /etc/nginx/dheera-visibility-regions.map
```

Install the site's `deployment/nginx.conf` vhost and publish a release containing both visibility CSS assets before enabling this endpoint. Then validate and reload:

```sh
sudo nginx -t
sudo systemctl reload nginx
curl -sSI https://dheera.net/visibility.css
```

The response should be `200`, `Content-Type: text/css`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`, with no additional public cache header. A missing or unreadable initial database makes `nginx -t` fail; keep the running configuration in place until that is fixed. Subsequent database updates are picked up by the GeoIP2 module within five minutes of requests, without an Nginx reload. See the [GeoIP2 module's auto-reload behavior](https://github.com/leev/ngx_http_geoip2_module#autoreload-default-disabled).

### Maintenance

```sh
sudo systemctl list-timers dheera-geoipupdate.timer
sudo journalctl -u dheera-geoipupdate.service --since '7 days ago'
sudo systemctl start dheera-geoipupdate.service
```

If an update fails, the existing database continues serving lookups; resolve the updater error so the data does not become stale. To change the license key, edit `/etc/GeoIP.conf` and start the updater service again. To disable regional hiding, comment out the two entries in `/etc/nginx/dheera-visibility-regions.map`, run `sudo nginx -t`, and reload Nginx. Keep the repository's map in sync with any server edits.

## Rollback

Read the previous release from the local receipt or inspect the server's `releases/` directory. Replace `RELEASE_ID` with a verified existing release directory name:

```sh
cd /var/www/dheera.net
test -f releases/RELEASE_ID/index.html
ln -s releases/RELEASE_ID .current-rollback
mv -Tf .current-rollback current
```

The symlink replacement is atomic and needs no Nginx reload. Reverting the initial cutover to the legacy app also requires restoring the saved Nginx vhost and restarting its saved supervisor; use the cutover backup rather than guessing the previous setup.

The uploader takes a local `.ec2-deploy-lock` and a server `/var/www/dheera.net/.deploy-lock`. A normal failure clears its own locks. After an interrupted process, confirm no deployment is running before removing a stale lock. Incomplete uploaded releases never become active automatically.

## Initial cutover record (2026-11-16 UTC)

The old application was supervised by `pm2-ubuntu.service`, not Forever. The static site replaced its reverse proxy, PM2 was stopped and disabled, the unused `socket_nodes` upstream was removed, and Nginx was brought under its enabled systemd service. Port 3000 is no longer listening. No DNS or IP changes were made.

Private server rollback files are in `/home/ubuntu/site-cutover-backup/20261116-xENseE/`: the original Nginx configuration, PM2 process dump/service and a complete legacy application archive. The stopped server checkout is also retained as `legacy-checkout/` in that backup directory. The previous local checkout was preserved outside this repository at `/home/dheera/code/web/dheera.net-legacy-20261116T044327Z`. These backups are not in Git or the web root.

The server is Ubuntu 20.04.6 with Ubuntu Pro unattached. Standard support ended in May 2025; migration to a fresh Ubuntu 26.04 LTS instance is recommended separately from the site cutover. Before replacing the instance, check whether its existing public IP is an Elastic IP that can be retained. No OS release upgrade or reboot was performed during the cutover. See [Ubuntu support dates](https://ubuntu.com/about/release-cycle).

The existing wildcard TLS certificate was retained and expires on December 15, 2026. Renew it or configure automatic certificate renewal before then. Certificate and key material remain on the server and in the owner's private directory, never in this repository.
