# Production: static Nginx on EC2

Production uses the existing Elastic IP and registrar/DNS configuration. A replacement instance is ready at `44.250.137.235`; the old server remains live until the owner moves the Elastic IP. Nginx serves complete static releases; no Node process, PM2, Forever, application database, or build tooling is needed on the server. Optional regional visibility uses a local MaxMind GeoLite2 database file.

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

On an existing server, back up the Nginx configuration and application supervisor state first. Complete the regional-visibility setup below before installing the reviewed `deployment/nginx.conf` as the site's enabled virtual host; the vhost references its GeoIP map. The current vhost uses `/etc/ssl/certs/STAR_dheera_net.pem` for the certificate chain and `/etc/ssl/private/STAR_dheera_net.key` for the private key. Keep the key owned by root with mode `0600`; certificate and key material must never enter the repository or web root. Publish a release before switching the virtual host to the static root. Test with `sudo nginx -t`, reload Nginx, and verify HTTP redirects, HTTPS, clean gallery URLs, both languages, media and real 404 responses. Stop and disable only a retired website's Node supervisor after the static site works. Nginx should be enabled and running under systemd.

Real downloads are kept in `public/files/` and included in every static release. The vhost preserves the résumé/profile-code redirects to these same-site files and legacy aliases for the galleries migrated to this site. Old posts and galleries not included in the new library return 404. It does not use an SPA fallback. Do not put private source or credentials under the document root.

## Replacement instance preparation

The new instance at `44.250.137.235` runs Ubuntu 26.04.1 LTS on ARM64, with the distribution's Nginx 1.28.3 package. Its role is limited to serving the static release and maintaining the local GeoIP database. Install the distribution packages for Nginx, `libnginx-mod-http-geoip2`, `geoipupdate`, rsync, Python 3, and automatic security updates. Do not migrate the old application checkout, process managers, build tools, or the old server's complete Nginx module configuration. The vhost uses separate `listen ... ssl;` and `http2 on;` directives supported by the new Nginx version; it is not intended to replace the older server's running vhost before cutover.

Transfer the existing certificate chain, matching private key, root-only GeoIP updater configuration, and GeoLite2 database securely over SSH. Install the TLS key at the private path above and `/etc/GeoIP.conf` with root ownership and mode `0600`; the database at `/var/lib/GeoIP/GeoLite2-City.mmdb` must be readable by Nginx. Check the certificate's names, expiry, trust chain and matching key before enabling HTTPS. No certificate, private key, MaxMind license, or private SSH key belongs in Git or a public release.

Apply all available package updates before readiness checks. The replacement was already current after refreshing the package indexes; the upgrade reported zero pending updates. The minimal Nginx/GeoIP packages were then installed from Ubuntu's repositories.

Install the repository's HTTP tuning and daily security-update configuration:

```sh
sudo install -o root -g root -m 644 deployment/nginx-http.conf /etc/nginx/conf.d/dheera-http.conf
sudo install -o root -g root -m 644 deployment/20auto-upgrades /etc/apt/apt.conf.d/20auto-upgrades
sudo systemctl enable --now apt-daily.timer apt-daily-upgrade.timer
sudo unattended-upgrade --dry-run --debug
```

Automatic updates use the distribution's security origins in `50unattended-upgrades`. Automatic reboots are disabled; check `/var/run/reboot-required` during maintenance and schedule a reboot when needed. No reboot was required during this preparation. Nginx and the update timers are enabled at boot. See [Ubuntu's automatic-update documentation](https://documentation.ubuntu.com/server/how-to/software/automatic-updates/).

### Deploy before the Elastic IP moves

Leave `deployment/ec2.json` unchanged: normal `npm run deploy` still targets `ubuntu@dheera.net`, which reaches the old production instance until cutover and the replacement afterward. Build with the production origin and call the exported deployment function with the temporary IP to prepare the replacement. This keeps canonical URLs unchanged and records the staging deployment separately:

```sh
npm run publish -- --site-url https://dheera.net
node --input-type=module <<'JS'
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { deployEC2 } from './deploy-ec2.mjs';

const lock = await open('.ec2-deploy-lock', 'wx');
try {
  const result = await deployEC2({
    target: {
      host: 'ubuntu@44.250.137.235',
      siteURL: 'https://dheera.net',
      directory: '/var/www/dheera.net',
    },
    identity: process.env.DHEERA_SSH_KEY || path.join(homedir(), 'private/aws/aws-us-west.pem'),
    releaseDir: path.resolve('dist'),
  });
  const receipts = '.published/deployments/new-instance';
  await mkdir(receipts, { recursive: true });
  await writeFile(path.join(receipts, 'current.json'), JSON.stringify(result, null, 2) + '\n');
} finally {
  await lock.close();
  await rm('.ec2-deploy-lock');
}
JS
```

The exported uploader performs the same public-file inventory, remote checksums, deployment lock, and atomic activation as production. Run this build/upload sequence without another concurrent publish. The ignored staging receipt must not overwrite `.published/deployments/production/current.json`. For the initial preparation, the existing local release was checked against the production receipt and uploaded unchanged, so the new server contains exactly the currently published site.

### Verify and cut over

Use the real hostname with an explicit destination IP, so HTTPS checks both the certificate and the intended virtual host without changing DNS. Do not add `-k`:

```sh
curl --resolve dheera.net:80:44.250.137.235 -sSI http://dheera.net/
curl --resolve dheera.net:443:44.250.137.235 -sSI https://dheera.net/
curl --resolve www.dheera.net:443:44.250.137.235 -sSI https://www.dheera.net/
curl --resolve dheera.net:443:44.250.137.235 -sSI https://dheera.net/photos/deepscapes/
curl --resolve dheera.net:443:44.250.137.235 -sSI https://dheera.net/zh-hant/photos/deepscapes/
curl --resolve dheera.net:443:44.250.137.235 -sSI https://dheera.net/resume
curl --resolve dheera.net:443:44.250.137.235 -sSI https://dheera.net/visibility.css
curl --resolve dheera.net:443:44.250.137.235 -sSI https://dheera.net/this-page-does-not-exist
```

Expect HTTP and `www` redirects to the canonical HTTPS domain, successful English/Chinese pages and media, the résumé download redirect, and a real 404 for the missing page. Verify the deployed content against the local release, not just response status. `/visibility.css` must send one `Cache-Control: private, no-store` header, and remain a 200 response when a conditional request is sent. Check `sudo nginx -t`, active/enabled Nginx, the GeoIP timer, the latest updater result, package-update status, and service recovery after any required reboot. Confirm the instance security group permits HTTP and HTTPS and that DNS has no overlooked AAAA record still directing visitors elsewhere.

The owner performs the Elastic IP reassociation only after readiness is confirmed. Leave the old server intact for rollback. After the move, repeat the public hostname checks without `--resolve`; normal deployment then follows `dheera.net` to the replacement. The temporary `44.250.137.235` address may stop being usable after reassociation.

SSH host keys identify the server, not the Elastic IP. Record the replacement server's public SSH host-key fingerprint through the established connection before cutover. A later connection to `dheera.net` may correctly report that its saved host key changed. Compare the presented key with the recorded replacement fingerprint before updating only that hostname/IP's stale `known_hosts` entries. Preserve strict host-key verification; do not use `StrictHostKeyChecking=no` or discard unrelated entries.

Readiness record — verified before the Elastic IP cutover on November 20, 2026 (Pacific time):

| Item | Result |
| --- | --- |
| Replacement address / OS | `44.250.137.235` / Ubuntu 26.04.1 LTS ARM64 |
| Nginx package | `1.28.3-2ubuntu1.14`; active and enabled; configuration test clean |
| Verified static release | `20261121T073204979Z-332a5757ee50`; all 893 public files verified; identical content to production |
| TLS expiry | December 15, 2026, 23:59:59 UTC; covers `dheera.net` and `*.dheera.net`; matching key and public trust verified |
| Certificate SHA-256 fingerprint | `7E:F4:71:F7:14:05:F7:BD:F1:8F:64:48:28:D2:60:A2:81:A6:BF:19:9A:C8:4D:5D:1C:0E:BB:8C:75:86:9A:B4` |
| Replacement SSH ED25519 fingerprint | `SHA256:ek3psc7oxX2w9cRGHXbb3CpPuD+58Rqj1GAMxCLP7ag` |
| Security updates / required reboot | No pending upgrades, no required reboot, no failed systemd units |
| Daily automatic security updates / automatic reboot policy | Both APT timers active/enabled; unattended-upgrade dry run passed; automatic reboots disabled |
| GeoIP update and single timer | Custom daily timer active/enabled; update succeeded; packaged duplicate timer disabled |
| External HTTPS, routes and content verification | HTTP/2 and certificate trust passed; 19 content/route/cache checks passed; private key and GeoIP config root-owned `0600` |
| Public DNS before cutover | `dheera.net` and `www.dheera.net` resolve to `34.212.118.230`; no AAAA addresses returned |
| Elastic IP cutover | Not performed; owner will reassociate it |

The new instance has only SSH and Nginx listening on public TCP ports (22, 80 and 443). Node, npm, PM2, Forever and Docker are not installed. Migration staging files were removed; private credentials were transferred directly over SSH without entering the local checkout. Local verification results and the staging deployment receipt are under ignored `.published/deployments/new-instance/`.

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

The Ubuntu module package enables its dynamic-module loader; do not add a duplicate `load_module` line. On the old Ubuntu 20.04 server, the unused legacy Perl module was disabled by renaming `/etc/nginx/modules-enabled/50-mod-http-perl.conf` to `50-mod-http-perl.conf.disabled`. Its Perl 5.30 interpreter crashed during an Nginx configuration reload; this static site has no Perl handlers. A full Nginx restart was used once to unload it. A fresh replacement does not need that module at all; do not copy the old module-loader directory. Ordinary subsequent configuration changes use a tested graceful reload.

Install the updater unit, make the first download, and then enable its timer:

```sh
sudo install -o root -g root -m 644 deployment/geoipupdate.service /etc/systemd/system/dheera-geoipupdate.service
sudo install -o root -g root -m 644 deployment/geoipupdate.timer /etc/systemd/system/dheera-geoipupdate.timer
sudo systemctl daemon-reload
sudo systemctl start dheera-geoipupdate.service
sudo test -s /var/lib/GeoIP/GeoLite2-City.mmdb
sudo systemctl enable --now dheera-geoipupdate.timer
```

The Ubuntu 26.04 package also supplies `geoipupdate.timer`. Disable its duplicate schedule when using the custom timer above:

```sh
sudo systemctl disable --now geoipupdate.timer
sudo systemctl list-timers --all '*geoip*'
```

On Ubuntu 20.04, the package instead installed a weekly cron job. The following diversion was used on the old server; apply it only on a server where `/etc/cron.d/geoipupdate` exists and is the duplicate schedule (the dot in the diverted filename makes cron ignore it):

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

Check `systemctl is-active nginx` and repeat the HTTPS check after several seconds; `nginx -t` alone cannot catch a module crash during reload.

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

At this initial cutover, the server was Ubuntu 20.04.6 with Ubuntu Pro unattached. Standard support ended in May 2025, so a fresh Ubuntu 26.04 LTS replacement was recommended separately from the application cutover. No OS release upgrade or reboot was performed during that cutover. This historical server remains live until the owner reassigns its Elastic IP to the replacement described above. See [Ubuntu support dates](https://ubuntu.com/about/release-cycle).

The existing wildcard TLS certificate was retained and expires on December 15, 2026. Renew it or configure automatic certificate renewal before then. Certificate and key material remain on the server and in the owner's private directory, never in this repository.
