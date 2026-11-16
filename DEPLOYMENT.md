# Production: static Nginx on EC2

Production uses the existing EC2 IP and registrar/DNS configuration. Nginx serves complete static releases; no Node process, PM2, Forever, database, or build tooling is needed on the server.

## Publish

Run from the repository root after editing the NAS content or theme (`npm run deploy:production` remains an alias):

```sh
npm run deploy -- --dry-run
npm run deploy
```

The command builds with the production URL in `deployment/ec2.json`, inventories only public output, uploads a new release with rsync, verifies every file's SHA-256 on the server, and atomically replaces `/var/www/dheera.net/current`. There is no Nginx restart during ordinary publication. HTML, styles and scripts use a 60-second cache lifetime. Old releases are retained for rollback; remove old releases manually only after confirming they are not active or needed.

`--dry-run` builds and checks locally without contacting or changing the server. A failed build/upload/checksum check leaves the active symlink unchanged. Local deployment receipts live in ignored `.published/deployments/production/current.json` and include the previous release target.

The SSH key is read from `--identity /path/to/key`, then `DHEERA_SSH_KEY`, then `~/private/aws/aws-us-west.pem`. It is never copied to the repository or server. SSH uses existing host-key verification and noninteractive authentication. `deployment/ec2.json` contains only public host/origin/path configuration. Local dependencies are Node 22.12+, OpenSSH, rsync and the normal npm packages; the server needs Nginx, rsync and Python 3.

Publication excludes the private build manifest, NAS originals, content sidecars, dependencies and credentials. The release validator rejects hidden files, symlinks, unknown files and design-preview controls. Uploaded releases must contain exactly the inventoried files before activation.

## Initial server setup

The deployment user needs write access to the release directory and `current` symlink, but not to Nginx configuration or TLS keys:

```sh
sudo install -d -o ubuntu -g ubuntu -m 755 /var/www/dheera.net
sudo install -d -o ubuntu -g ubuntu -m 755 /var/www/dheera.net/releases
```

Back up the existing Nginx configuration and application supervisor state first. Install the reviewed `deployment/nginx.conf` as the site's enabled virtual host, retaining the existing certificate and key at their server-only paths. Publish a release before switching the virtual host to the static root. Test with `sudo nginx -t`, reload Nginx, and verify HTTP redirects, HTTPS, clean gallery URLs, both languages, media and real 404 responses. Stop and disable only the retired website's Node supervisor after the static site works. Nginx should be enabled and running under systemd.

Real downloads are kept in `public/files/` and included in every static release. The vhost preserves the résumé/profile-code redirects to these same-site files and legacy aliases for the galleries migrated to this site. Old posts and galleries not included in the new library return 404. It does not use an SPA fallback. Do not put private source or credentials under the document root.

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
