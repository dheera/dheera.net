# dheera.net static publishing

The editable source is `/stuff/publish`. Eleventy builds complete English and Traditional Chinese HTML pages. The theme lives separately from content preparation. Published pages need no application server or LLM; JavaScript only enhances the gallery viewer and presentation controls.

Production runs directly on Nginx at `https://dheera.net`, on the existing EC2 instance. Source code lives at this repository's root. NAS content and server credentials remain outside Git.

## Everyday workflow

Run these commands from `/home/dheera/code/web/dheera.net`:

The existing checkout is configured for `/stuff/publish` in ignored `publish.local.json`. On a fresh checkout, create that file with `{ "source": "/stuff/publish" }`, or set `PUBLISH_SOURCE`. There is no fallback sample library. To initialize a new empty library, run `npm run init-library -- --source /path/to/library`.

```sh
npm run translate             # fill missing Chinese text into local files
npm run translations:status   # list missing or outdated translations; read-only
npm run publish               # build the saved content into a complete static site
npm run preview               # serve the active build at http://localhost:4173
npm run deploy                # build, upload, verify, and activate on dheera.net
```

`build` is an alias for the local `publish` command. Neither command invokes an LLM or uploads anything. Photo-only changes can go straight to `publish`. For a theme-only change, `npm run build:theme` reuses prepared content and does not read the NAS or reprocess images.

`npm run deploy -- --dry-run` validates the production build without contacting the server. The production uploader verifies all uploaded file hashes before atomically changing the active release, and keeps the previous release for rollback. See [Deployment](DEPLOYMENT.md) for configuration and recovery. `npm run deploy:production` is an alias for the same EC2 deployment.

Normal builds omit the design-preview toolbar and use `defaultStyle` from `site.md`. To temporarily include style comparison controls, run `npm run build:theme -- --design-preview` (or `npm run publish -- --design-preview`). Run `npm run publish` without that flag for the output you will deploy. The flag is per-build and is never remembered by later builds.

`dist/` is a symlink to the current complete output directory. It contains HTML, images, CSS, fonts, scripts, sitemap.xml and robots.txt. Each `.published/releases/<id>/` directory is also a complete standalone site. A static host needs directory-index support and a custom 404 page; no SPA fallback is needed. The local server is only for preview.

## Content layout

```text
/stuff/publish/
  .publish-library
  .translations/state.json   translation source hashes / review state
  site.md
  site.zh-Hant.md
  about.md
  about.zh-Hant.md
  assets/profile.jpg
  assets/travel.geojson      editable travel places and routes
  photos/
    icelandthermal/
      gallery.md             optional title, intro, cover, layout
      gallery.zh-Hant.md      saved Chinese text, editable
      01.jpg
      01.md                  optional caption/story
      01.zh-Hant.md           saved Chinese caption/story, editable
  projects/
    rosshow/
      project.md
      project.zh-Hant.md
      cover.png
```

`site.md` owns the name, contact/profile links, homepage headline and introduction, and `defaultStyle` (`midnight`, `editorial`, or `museum`). `about.md` owns its title, Markdown body and optional source-relative `portrait` and `travelMap`. Only the NAS library supplies site content; the repository contains no sample galleries or starter copy.

`travelMap: assets/travel.geojson` adds the inline About map. Its GeoJSON FeatureCollection contains Point and LineString features with `id`, `name`, and `kind` properties. Edit this local data and publish; it is a saved snapshot, not a live Google embed. The original imported KML is retained as `assets/travel-source.kml`. Natural Earth land geometry is bundled locally; projection happens at build time and the browser enhances the static SVG with pan/zoom and place selection. Remove `travelMap` to omit the map.

Publishing generates public WebPs from the NAS originals and does not copy original JPEGs into `dist`.

Photo sidecars and every photo metadata field are optional. Add, replace, edit or delete images and run publish. Explicit numeric order comes first; ties and unordered photos use natural filename order. A stable `slug` keeps a gallery's URL unchanged when you rename its folder. A gallery can use `layout: grid` or `layout: exhibition`; captions can be short or long Markdown stories.

### Paired photographs

Use `layout: pairs` in `gallery.md` for a collection of image pairs. Each pair has its own folder:

```text
photos/timetravelchina/
  gallery.md
  gallery.zh-Hant.md
  01-lanzhou/
    a.jpg
    b.jpg
    original.jpg       optional archival copy; ignored by publishing
    pair.md            optional title, labels, order, caption/story
    pair.zh-Hant.md     optional saved Chinese text
  02-wuhan/
    a.jpg
    b.jpg
```

`a` and `b` are neutral identifiers: they can represent different dates, day/night, visible/infrared, or any other pairing. They accept the same image extensions as ordinary photographs, including JPEG, PNG, WebP, AVIF and TIFF; keep exactly one image with each stem. Other files, including `original.jpg`, are not rendered or published. For this layout, the publisher reads pair subfolders instead of loose images at the gallery root.

An optional `pair.md` can look like this:

```md
---
title: Lanzhou
a:
  label: "~1910"
  alt: The iron bridge in the historical photograph.
b:
  label: "2016"
  alt: The iron bridge photographed from a similar viewpoint in 2016.
---
~1910 photographer unknown · 2016 Dheera Venkatraman

An optional longer story about the location or the photographs.
```

Credits belong in the Markdown caption with any story; there is no separate credit field. Every sidecar field is optional. Without a sidecar, the labels are **A** and **B**, with no invented title or caption. A is first and B is second. Both photographs are shown together: side by side on desktop, stacked on mobile, with labels and their shared caption. Paired galleries have no selector, slider, lightbox or zoom controls and need no JavaScript.

Pairs follow natural folder-name order. An optional numeric `order:` in `pair.md` puts that pair before unordered pairs; ties use folder names. Set a gallery cover with a relative path such as `cover: 01-lanzhou/a.jpg`; the default is A from the first pair. Add a pair folder, replace A or B, edit its sidecar, or remove the folder, then publish as usual. A missing or duplicate A/B image stops the build and preserves the previous release.

`pair.zh-Hant.md` contains translated `title`, `a.label`, `a.alt`, `b.label`, `b.alt`, and Markdown caption text only. The existing missing-only translation workflow handles these nested fields, preserving any text you already edited. Images, folder names and ordering are shared between languages.

### Projects

A project folder contains `project.md`. Metadata supports `title`, `summary`, `slug`, `cover`, `href`, `github`, `demo`, `video`, `order`, `tags`, `draft`. Explicit `href` opens directly. Otherwise a story or video gets a local page; a metadata-only entry points to its demo or GitHub. No redundant article is required for code distributed on GitHub. Referenced local images, MP4/WebM videos and PDFs are published with content hashes. Local videos are copied unchanged. Interactive applications keep their own build/deployment and link by URL.

`video` accepts either a project-relative MP4/WebM path or an HTTPS YouTube URL. For example, `video: https://www.youtube.com/shorts/GcAxKKQDbNw` embeds a responsive portrait player; ordinary watch, `youtu.be`, and embed URLs use a landscape player. The YouTube player uses the privacy-enhanced `youtube-nocookie.com` embed. The URL stays in the English `project.md` and is shared by both languages, so Chinese sidecars only need translated text. `cover` still supplies the project card image. Keep any separate demo or longer video link in `demo`.

## Translations: fill missing text only

Generated Chinese is written to ordinary `*.zh-Hant.md` files alongside the English source. Edit those exact files in your editor. Back them up with the rest of the NAS text files.

**The translator never replaces or deletes an existing nonempty translation, including text it previously generated.** It fills missing fields/body only. If English changes, existing Chinese remains unchanged and the status command flags it for review. To regenerate text, remove that translated field or body (or the whole Chinese file), then run `translate`. A missing English caption never causes an invented caption.

After reviewing outdated Chinese, `npm run translate -- --accept-reviewed` records that it matches the current English. It preserves all existing translated text.

Translation review state records source hashes in `.translations/state.json`. It is not the translation text and is not published. Keep it in backups to retain stale-source detection. When text is no longer present in English, the build ignores its old translated body/optional text, while keeping your Chinese source file intact.

Only translated text belongs in Chinese sidecars. Media paths, filenames, ordering, slugs and layout configuration remain shared in the English source. Markdown link/image destinations and code are validated before generated translations are saved. An adapter failure or concurrent source edit aborts generation before file replacement. Each changed sidecar is saved atomically.

New text needs an LLM adapter or handwritten Chinese. Missing translations fall back to English and are reported by the build. Publishing never silently changes them.

### Optional OpenAI adapter

The bundled adapter uses the [Responses API structured output format](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). Configure `OPENAI_API_KEY` securely in your shell and set `TRANSLATION_MODEL` to the model you want to use; no model or paid service is silently selected. Then:

```sh
npm run translate -- --translator /home/dheera/code/web/dheera.net/adapters/openai.mjs
```

Or set `GALLERY_TRANSLATOR` to that executable for subsequent translation runs. Credentials stay in environment variables, never in content or generated output. The adapter has been tested with simulated responses; no live API request is part of the local build.

Any executable can implement the adapter instead: JSON stdin has `sourceLanguage`, `targetLanguage`, `instructions`, and `items` with `id`, `text`, and document `context`. JSON stdout must contain `{ "translations": { "item-id": "translated text" } }`. Diagnostics go to stderr. Source files are written only after all requested results validate.

## Design and interface text

```text
theme/assets/tokens.css                  fonts, palette, type sizes, spacing
theme/assets/styles.css                  layouts and responsive behavior
theme/templates/_includes/layouts/       HTML document shell
theme/templates/_includes/pages/         home, gallery, projects, project, About
theme/templates/_includes/partials/      navigation, cards, image markup
theme/locales/en.json                    English interface labels
theme/locales/zh-Hant.json               Chinese interface labels
theme/assets/gallery.js                  PhotoSwipe enhancement
theme/assets/pairs.css                   paired-photograph layout
theme/assets/site.js                     style/layout controls
theme/assets/travel-map.css              map appearance
theme/assets/travel-map.js               map interaction
```

Change these files to redesign the site; no publishing logic or NAS content migration is needed. Midnight uses self-hosted DM Sans with system Chinese fallbacks. PhotoSwipe 5.4.4 supplies touch swipe and zoom for ordinary galleries; paired galleries display their images directly. Themes share the same content.

`lib/static-site.mjs` turns prepared content into page data for Eleventy. `lib/publisher.mjs`, `projects.mjs`, `site-content.mjs` and `image-cache.mjs` prepare content and assets. `lib/local-translations.mjs` is the explicit translation-file workflow. `lib/releases.mjs` builds and activates complete static releases.

## URLs and hosting

English pages use `/photos/deepscapes/`, `/projects/`, `/about/`; Chinese uses `/zh-hant/photos/deepscapes/`, `/zh-hant/projects/`, `/zh-hant/about/`. Each directory contains `index.html`. The preview redirects extensionless directory paths without a trailing slash to the slash form. Language switching links to the equivalent page. Both versions have full text, metadata, canonical URLs and reciprocal language annotations before any browser JavaScript executes.

Photos, Projects and About appear in the top navigation; language selection lives in the footer. An explicit selection is remembered locally. A fresh visit to `/` uses the first supported language in the browser's ordered language preferences, mapping Chinese variants to Traditional Chinese. Existing deep links, internal navigation, and browser Back keep their own language. This is a browser enhancement; HTTP `Accept-Language` negotiation could be added to Nginx later. Without JavaScript, both language versions and their links still work.

Set `siteURL` in ignored `publish.local.json`, or use `--site-url`, to change canonical/social/sitemap URLs. The default is `https://dheera.net`. Existing content uses the configured `source`, overridden by `--source` or `PUBLISH_SOURCE`.

`deployment/ec2.json` contains the deployment host, site URL and remote release directory. `npm run deploy` builds from the configured NAS library, transfers only public files over SSH/rsync, verifies their hashes and atomically activates the complete release. All public responses use a 60-second cache lifetime. The private build manifest is never uploaded.

The existing `/resume`, `/resume.pdf`, `/profile_code` and `/profile_code.txt` URLs redirect to files served on this same site. Their source files live in `public/files/` in the repository; replace a PDF or text file there and deploy to update it. The publisher includes these real public downloads in every release.

See [DEPLOYMENT.md](DEPLOYMENT.md) for setup, publishing and rollback.

## Repository and credentials

Commit source, theme files, tests and public deployment settings. Keep NAS originals/content, `.published/`, `dist`, local configuration, SSH keys, credentials and environment files outside Git. The SSH credential is read from the local private key, never copied to the server's public directory.

Before committing, run `npm run check:secrets` to scan the exact staged blobs. `npm run check:secrets -- --all-tracked` scans the complete Git index. The check reports filenames and rule names without exposing matched values. Enable the repository pre-commit hook with `git config core.hooksPath .githooks`. Pattern scanning is a safeguard, not a guarantee; review the staged file list as well.

## Build behavior and limits

Responsive WebP images are generated up to 2560px on the long edge. Unchanged image files reuse cached renditions based on file identity, size and modification/change timestamps. A theme-only build avoids even the NAS scan. Videos/PDFs are copied and hashed; they are not transcoded.

The output is built in staging and activated only after successful generation. A failed build leaves the previous release active. Removing all projects and galleries requires `--allow-empty`; an absent library marker or missing collection directory fails instead of publishing accidental disappearance. Old releases and media cache are retained; automatic retention is not yet configured. The active release includes only the media it references.

Node 22.12+ is required. Run `npm ci` after checkout and `npm test` for integration checks. Tests cover static HTML and shared assets, content changes/deletions, failure preservation, local translation edit protection, and adapter failures. No tests call a live LLM.

Future writing can be `writing/<slug>/index.md` with YAML title/date/summary/draft plus a matching Chinese file. Add its collection/template and navigation when the first piece is ready; no empty Writing section is shown now.
