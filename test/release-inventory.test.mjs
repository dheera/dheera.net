import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inventoryRelease } from '../lib/release-inventory.mjs';

const target = { siteURL: 'https://example.com' };

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dheera-inventory-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseDir = path.join(root, '12345678-abcdef12');
  const files = {
    'index.html': '<html><link rel="canonical" href="https://example.com/"></html>',
    '404.html': '<html>Missing</html>', 'zh-hant/index.html': '<html lang="zh-Hant">你好</html>',
    'photos/harbor/index.html': '<html>Harbor</html>',
    'sitemap.xml': '<urlset/>', 'robots.txt': 'User-agent: *',
    'media/abc-640.webp': 'image fixture', 'assets/site.js': 'console.log("hello")',
    'assets/styles.css': 'body { color: white; }', 'fonts/site.woff2': 'font fixture',
    'visibility.css': '/* Normal fallback */',
    'assets/visibility-normal.css': '/* Normal view */',
    'assets/visibility-limited.css': '[data-visibility="about"] { display: none !important; }',
    'files/resume.pdf': '%PDF-public-file', 'files/profile_code.txt': 'Public profile code',
    'manifest.json': '{"sourceId":"private-local-build-model"}',
  };
  for (const [key, body] of Object.entries(files)) {
    const filename = path.join(releaseDir, key);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, body);
  }
  return { root, releaseDir };
}

test('release inventory hashes only public files and excludes the private build model', async t => {
  const f = await fixture(t);
  const { manifest } = await inventoryRelease(f.releaseDir, target);
  assert.equal(manifest.objects.length, 15);
  assert.ok(!manifest.objects.some(file => file.key === 'manifest.json'));
  assert.doesNotMatch(JSON.stringify(manifest), /private-local-build-model|sourceId|\/tmp\//);
  assert.equal(manifest.objects.find(file => file.key === 'files/resume.pdf').contentType, 'application/pdf');
  assert.equal(manifest.objects.find(file => file.key === 'files/profile_code.txt').contentType, 'text/plain; charset=utf-8');
  for (const key of ['visibility.css', 'assets/visibility-normal.css', 'assets/visibility-limited.css']) {
    assert.equal(manifest.objects.find(file => file.key === key).contentType, 'text/css; charset=utf-8');
  }
  assert.ok(manifest.objects.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  await writeFile(path.join(f.releaseDir, 'assets/site.js'), 'changed script');
  const updated = (await inventoryRelease(f.releaseDir, target)).manifest;
  assert.notEqual(updated.objects.find(file => file.key === 'assets/site.js').sha256, manifest.objects.find(file => file.key === 'assets/site.js').sha256);
});

test('release inventory refuses hidden files, unknown assets and nested public downloads', async t => {
  const f = await fixture(t);
  for (const [name, message] of [
    ['.env', /Hidden file/],
    ['assets/.credentials', /Hidden file/],
    ['files/.hidden.pdf', /Hidden file/],
    ['files/nested/private.txt', /Unexpected public file/],
    ['files/script.js', /Unexpected public file/],
    ['assets/key.pem', /Unexpected public file/],
    ['private.txt', /Unexpected public file/],
    ['other.css', /Unexpected public file/],
  ]) {
    const filename = path.join(f.releaseDir, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, 'Should not publish');
    await assert.rejects(inventoryRelease(f.releaseDir, target), message);
    await rm(filename);
  }
});

test('release inventory rejects symlink files and directories, design controls, and missing pages', async t => {
  const f = await fixture(t);
  for (const [source, link] of [
    [path.join(f.releaseDir, 'index.html'), path.join(f.releaseDir, 'assets/escape.html')],
    [f.root, path.join(f.releaseDir, 'assets/escape')],
  ]) {
    await symlink(source, link);
    await assert.rejects(inventoryRelease(f.releaseDir, target), /Symlink/);
    await rm(link);
  }
  await writeFile(path.join(f.releaseDir, 'photos/harbor/index.html'), '<html data-design-preview="true"></html>');
  await assert.rejects(inventoryRelease(f.releaseDir, target), /Design-preview/);
  await rm(path.join(f.releaseDir, 'photos/harbor/index.html'));
  await rm(path.join(f.releaseDir, '404.html'));
  await assert.rejects(inventoryRelease(f.releaseDir, target), /Incomplete release/);
});

test('release inventory requires the intended HTTPS origin and matching canonical URL', async t => {
  const f = await fixture(t);
  for (const siteURL of ['http://example.com', 'https://example.com/path', 'https://example.com?other', 'https://user@example.com']) {
    await assert.rejects(inventoryRelease(f.releaseDir, { siteURL }), /HTTPS origin/);
  }
  await assert.rejects(inventoryRelease(f.releaseDir, { siteURL: 'https://other.example.com' }), /canonical URL/);
});
