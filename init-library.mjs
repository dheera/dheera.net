import { parseArgs } from 'node:util';
import { mkdir, readFile, readdir, stat, writeFile, cp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url));
const { values } = parseArgs({ options: {
  source: { type: 'string' }, 'with-examples': { type: 'boolean', default: false },
} });
try {
  if (!values.source) throw new Error('Usage: npm run init-library -- --source /path/to/publish [--with-examples]');
  const source = path.resolve(values.source);
  if (!(await stat(source)).isDirectory()) throw new Error('Choose an existing mounted directory.');
  for (const name of ['photos', 'projects', 'assets']) await mkdir(path.join(source, name), { recursive: true });
  await cp(path.join(dir, 'starter-content'), source, { recursive: true, force: false, errorOnExist: false });
  if (values['with-examples']) {
    for (const entry of await readdir(path.join(dir, 'sample-library'), { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) await cp(path.join(dir, 'sample-library', entry.name), path.join(source, 'photos', entry.name), { recursive: true, force: false });
    }
    await cp(path.join(dir, 'starter-projects'), path.join(source, 'projects'), { recursive: true, force: false });
  }
  const markerPath = path.join(source, '.publish-library');
  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    if (marker.version !== 1 || !marker.id) throw new Error('Existing library marker is invalid.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(markerPath, JSON.stringify({ version: 1, id: randomUUID() }) + '\n', { flag: 'wx' });
  }
  await writeFile(path.join(dir, 'publish.local.json'), JSON.stringify({ source }, null, 2) + '\n');
  console.log(`Content library ready: ${source}\nExisting files were preserved. Run npm run publish to update the local site.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
