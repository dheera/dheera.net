import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateLibrary } from './lib/local-translations.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
let local = {};
try { local = JSON.parse(await readFile(path.join(directory, 'publish.local.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const { values } = parseArgs({ options: {
  source: { type: 'string', default: process.env.PUBLISH_SOURCE ?? local.source ?? path.join(directory, 'sample-library') },
  translator: { type: 'string' }, seed: { type: 'string', multiple: true }, cache: { type: 'string' },
  status: { type: 'boolean', default: false }, 'accept-reviewed': { type: 'boolean', default: false }, 'accept-manual': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });

function printReport(report) {
  const { counts } = report;
  console.log(`Translations: ${counts.missing} missing, ${counts.stale} stale, ${counts.manual} manual, ${counts.conflicts} need review.`);
  for (const detail of report.details.filter(detail => ['missing', 'stale', 'conflict', 'obsolete'].includes(detail.status))) {
    console.log(`  ${detail.file} [${detail.field}]: ${detail.status}${detail.manual ? ' (manual; preserved)' : ''}`);
  }
  for (const file of report.changedFiles) console.log(`Updated ${file}`);
  if (report.stateUpdated && !report.changedFiles.length) console.log('Updated translation review state; translation text is unchanged.');
}

if (values.help) {
  console.log('Usage: node translate.mjs [--source /path/to/library] [--status] [--translator /path/to/executable] [--seed file.json ...] [--cache file.json] [--accept-reviewed]\nWithout --status, fills missing local .zh-Hant.md fields. Existing translations are never overwritten or deleted. --accept-reviewed acknowledges existing translations against the current English source without changing text. --status only reads files; it never calls a translator.');
} else {
  try {
    const result = await translateLibrary({
      sourceDir: path.resolve(values.source), statusOnly: values.status, acceptReviewed: values['accept-reviewed'] || values['accept-manual'],
      translatorCommand: values.translator ?? process.env.GALLERY_TRANSLATOR,
      seedPath: values.seed ?? ['sample-translations.json', 'project-translations.json', 'starter-translations.json'].map(file => path.join(directory, file)),
      cachePath: values.cache ?? path.join(directory, '.published', '.translation-cache.json'),
    });
    printReport(result);
    if (!values.status && result.counts.conflicts) console.log('Review existing translations, then use --accept-reviewed to acknowledge them. To regenerate a field, delete its Chinese text and run translate again.');
  } catch (error) {
    if (error.report) printReport(error.report);
    console.error(`Translation update failed: ${error.message}`);
    process.exitCode = 1;
  }
}
