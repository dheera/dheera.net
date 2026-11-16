import { parseArgs } from 'node:util';
import { readFile, writeFile, stat, lstat, symlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishLibrary } from './lib/publisher.mjs';
import { rebuildSite } from './lib/releases.mjs';
import { inspectTranslations } from './lib/local-translations.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));
let local = {};
try { local = JSON.parse(await readFile(path.join(dir, 'publish.local.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const { values } = parseArgs({ options: {
  source: { type: 'string', default: process.env.PUBLISH_SOURCE ?? local.source ?? path.join(dir, 'sample-library') },
  out: { type: 'string', default: path.join(dir, '.published') },
  init: { type: 'boolean', default: false },
  'allow-empty': { type: 'boolean', default: false },
  'theme-only': { type: 'boolean', default: false },
  'design-preview': { type: 'boolean', default: false },
  'site-url': { type: 'string', default: local.siteURL ?? 'https://dheera.net' },
  help: { type: 'boolean', default: false },
} });
if (values.help) {
  console.log('Usage: npm run publish -- [--source /path/to/publish] [--out path] [--allow-empty] [--theme-only] [--design-preview] [--site-url https://dheera.net]\nBuilds static HTML locally. Translation generation is separate: npm run translate. No network upload or LLM call happens during build.');
} else {
  try {
    const sourceDir = path.resolve(values.source);
    if (values.init) {
      if (!(await stat(sourceDir)).isDirectory()) throw new Error('Source must be an existing directory.');
      const file = path.join(sourceDir, '.gallery-library');
      try { await readFile(file); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await writeFile(file, JSON.stringify({ version: 1, id: randomUUID() }) + '\n', { flag: 'wx' });
      }
    }
    const outputDir = path.resolve(values.out);
    const dist = path.join(dir, 'dist');
    try { if (!(await lstat(dist)).isSymbolicLink()) throw new Error('The dist export path exists and is not a symlink. Move it aside before building.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const exportLink = path.join(dir, `.dist-${randomUUID()}`);
    await symlink(path.relative(dir, path.join(outputDir, 'dist')), exportLink);
    await rename(exportLink, dist);
    const report = values['theme-only'] ? null : await inspectTranslations({ sourceDir });
    const manifest = values['theme-only']
      ? await rebuildSite({ outputDir, siteURL: values['site-url'], designPreview: values['design-preview'] })
      : await publishLibrary({ sourceDir, outputDir, allowEmpty: values['allow-empty'], siteURL: values['site-url'], designPreview: values['design-preview'] });
    console.log(`Published ${manifest.galleries.length} galleries / ${manifest.galleries.reduce((sum, g) => sum + g.imageCount, 0)} photos / ${manifest.projects.length} projects locally.`);
    if (report) {
      const { missing, stale, conflicts } = report.counts;
      console.log(`Translations: ${missing} missing, ${stale} stale, ${conflicts} need review. Run npm run translations:status for paths; npm run translate to generate saved files.`);
    }
    console.log(`Complete static site: ${dist}`);
    if (values['design-preview']) console.log('Design preview controls are included in this build. Run npm run publish without --design-preview before deployment.');
    console.log('Refresh http://localhost:4173 to see this release.');
  } catch (error) {
    console.error(`Build failed: ${error.message}\nA failed build does not replace the active release.`);
    process.exitCode = 1;
  }
}
