import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, cp, symlink, writeFile, readFile, readdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dheera-library-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['init-library.mjs', 'publish.mjs', 'translate.mjs']) {
    await cp(path.join(repository, file), path.join(root, file));
  }
  await symlink(path.join(repository, 'lib'), path.join(root, 'lib'));
  const source = path.join(root, 'library');
  await mkdir(source);
  const env = { ...process.env };
  delete env.PUBLISH_SOURCE;
  delete env.GALLERY_TRANSLATOR;
  return {
    root, source,
    run: (file, args = [], overrides = {}) => exec(process.execPath, [path.join(root, file), ...args], {
      cwd: root, env: { ...env, ...overrides }, maxBuffer: 1024 * 1024,
    }),
  };
}

test('library initialization creates only empty content folders and preserves authored files/configuration', async t => {
  const f = await fixture(t);
  const configPath = path.join(f.root, 'publish.local.json');
  await writeFile(configPath, JSON.stringify({ source: '/previous/library', siteURL: 'https://example.com' }));
  await f.run('init-library.mjs', ['--source', f.source]);
  assert.deepEqual((await readdir(f.source)).sort(), ['.publish-library', 'assets', 'photos', 'projects']);
  for (const name of ['assets', 'photos', 'projects']) assert.deepEqual(await readdir(path.join(f.source, name)), []);
  const marker = await readFile(path.join(f.source, '.publish-library'), 'utf8');
  await writeFile(path.join(f.source, 'about.md'), 'My authored introduction.');
  await f.run('init-library.mjs', ['--source', f.source]);
  assert.equal(await readFile(path.join(f.source, 'about.md'), 'utf8'), 'My authored introduction.');
  assert.equal(await readFile(path.join(f.source, '.publish-library'), 'utf8'), marker);
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), { source: f.source, siteURL: 'https://example.com' });
});

test('publish and translation commands fail without a configured source before changing the active output', async t => {
  const f = await fixture(t);
  await symlink('existing-output', path.join(f.root, 'dist'));
  for (const [file, args] of [['publish.mjs', []], ['translate.mjs', ['--status']]]) {
    await assert.rejects(f.run(file, args), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Configure a content source/);
      return true;
    });
  }
  assert.equal(await readlink(path.join(f.root, 'dist')), 'existing-output');
  assert.deepEqual(await readdir(f.source), []);
});

test('configured content source supports publishing and explicit translation seeds without bundled content', async t => {
  const f = await fixture(t);
  await f.run('init-library.mjs', ['--source', f.source]);
  await writeFile(path.join(f.source, 'about.md'), 'A hand-built robot.');
  const seed = path.join(f.root, 'translations.json');
  await writeFile(seed, JSON.stringify({ 'A hand-built robot.': '手作機器人。' }));
  await f.run('translate.mjs', ['--seed', seed]);
  assert.match(await readFile(path.join(f.source, 'about.zh-Hant.md'), 'utf8'), /手作機器人/);
  const { stdout } = await f.run('publish.mjs');
  assert.match(stdout, /Published 0 galleries \/ 0 photos \/ 0 projects locally/);
  assert.match(await readFile(path.join(f.root, 'dist', 'zh-hant', 'about', 'index.html'), 'utf8'), /手作機器人/);
  const status = await f.run('translate.mjs', ['--status']);
  assert.match(status.stdout, /Translations: 0 missing/);
});
