import { parseArgs } from 'node:util';
import { mkdir, readFile, stat, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url));
const { values } = parseArgs({ options: {
  source: { type: 'string' },
} });
try {
  if (!values.source) throw new Error('Usage: npm run init-library -- --source /path/to/publish');
  const source = path.resolve(values.source);
  if (!(await stat(source)).isDirectory()) throw new Error('Choose an existing mounted directory.');
  const configPath = path.join(dir, 'publish.local.json');
  let config = {};
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Existing publish.local.json must contain an object.');
  const markerPath = path.join(source, '.publish-library');
  try {
    const marker = JSON.parse(await readFile(markerPath, 'utf8'));
    if (marker.version !== 1 || !marker.id) throw new Error('Existing library marker is invalid.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(markerPath, JSON.stringify({ version: 1, id: randomUUID() }) + '\n', { flag: 'wx' });
  }
  for (const name of ['photos', 'projects', 'assets']) await mkdir(path.join(source, name), { recursive: true });
  const configTemp = path.join(dir, `.publish-config-${randomUUID()}`);
  try {
    await writeFile(configTemp, JSON.stringify({ ...config, source }, null, 2) + '\n', { flag: 'wx' });
    await rename(configTemp, configPath);
  } finally {
    await rm(configTemp, { force: true });
  }
  console.log(`Content library ready: ${source}\nExisting files were preserved. Run npm run publish to update the local site.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
