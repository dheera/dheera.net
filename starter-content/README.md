# dheera.net content

This directory is the editable source for the local website. The website reads a published copy, so editing these files does not change the preview until you publish.

```sh
npm --prefix /home/dheera/code/web/dheera.net run publish
```

Open http://localhost:4173 and refresh after publishing. This command currently publishes locally, not to S3.

## Files

- `site.md`: name, contact/profile links, default style, homepage headline, introduction.
- `about.md`: About page draft. Edit freely.
- `assets/`: shared source assets such as the profile photograph.
- `photos/<gallery>/`: photographs and optional `gallery.md` and photo `.md` sidecars.
- `projects/<project>/`: a `project.md` and any local images, videos, or PDFs it references.
- `.publish-library`: library identity; keep this file so an unavailable NAS cannot look like an empty library.

The initial photographs are small copies from the existing public site, and project descriptions are a starting selection from public work. Replace or remove them as desired. Source originals remain elsewhere.

## Photos

Put selected images in a gallery directory. Sidecars are optional. A `photo.jpg` can have `photo.md` with an optional YAML header and a Markdown caption:

```markdown
---
title: A title, if needed
alt: A short description of what is visible.
order: 10
---

A caption or a longer story.
```

Explicit `order` comes first, lowest number first; ties and all unordered photos use natural filename order. A `gallery.md` can provide `title`, stable `slug`, `cover`, `layout: grid` or `layout: exhibition`, and an introduction. Images need unique stems within a gallery.

## Projects

A code-first project can be metadata only:

```markdown
---
title: My tool
summary: What it does, in a sentence.
href: https://github.com/dheera/my-tool
cover: assets/cover.png
order: 10
---
```

Its card opens `href` directly. Replace the example URL with the real destination. `github` and `demo` add secondary links. A demo-only project can use `demo` as its destination. Keep interactive application code in its own repository/deployment.

For a local project page, omit `href` and add Markdown:

```markdown
---
title: A thing I built
summary: A short introduction.
cover: assets/finished.jpg
github: https://github.com/dheera/my-project
video: assets/demonstration.mp4
---

The story behind the project.

![The mechanism](assets/mechanism.jpg)
```

Every metadata field is optional; only include links/assets you have. `draft: true` hides an unfinished project. A project needs a destination or some content; empty placeholders are rejected. Supported local project assets are images, MP4/WebM video, and PDF downloads. Videos are copied unchanged; export a web-friendly version before publishing. A video gets a native player with seeking support.

## Traditional Chinese

Run the explicit translation step to fill missing Chinese text into local files:

```sh
npm --prefix /home/dheera/code/web/dheera.net run translate
npm --prefix /home/dheera/code/web/dheera.net run translations:status
```

Edit the corresponding `site.zh-Hant.md`, `about.zh-Hant.md`, `gallery.zh-Hant.md`, `photo.zh-Hant.md`, or `project.zh-Hant.md` directly. The translator fills missing text only: existing translations are never replaced or deleted, including generated ones. If English changes, Chinese is preserved and flagged for review. To regenerate a field/body, remove that translated text and run translate again.

The original English sidecar owns ordering, layout, slugs, URLs and assets. Chinese sidecars contain translated text only. `.translations/state.json` records source hashes for review; back it up with your content. Nothing in this state directory is published.

The starter translations are already available locally. For future text, configure an adapter as described in the code checkout's README, or write the Chinese yourself. Publishing only reads saved files and never calls a translation service. Missing Chinese falls back to English.

## Updates

Edit, replace, add, or delete content, then publish again. Changed images get fresh URLs. A failed publish leaves the previous site available. Deleting a project folder removes its card and page. Orphaned photo sidecars are ignored. To intentionally remove all photos and projects, use `--allow-empty`.

Do not edit the generated `.published` directory in the code checkout. The editing source is this directory.

## Static output and design

The generated static website lives at `/home/dheera/code/web/dheera.net/dist/`. English and Chinese have separate HTML pages with clean URLs, for example `/photos/deepscapes/` and `/zh-hant/photos/deepscapes/`. Theme templates, CSS and interface dictionaries live in `theme/` in the code checkout. `npm run build:theme` there rebuilds the design without reading this NAS library.
