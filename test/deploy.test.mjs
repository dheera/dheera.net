import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inventoryRelease, createDeployPlan, deployRelease, awsCLI } from '../lib/deploy.mjs';

const target = {
  bucket: 'dheera-test-preview', region: 'us-west-2', profile: 'dheera-site',
  siteURL: 'https://preview.example',
  cacheControl: 'public, max-age=60, s-maxage=60, must-revalidate, stale-if-error=0',
  invalidateCloudFront: false,
};

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dheera-deploy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseDir = path.join(root, '12345678-abcdef12');
  const files = {
    'index.html': '<html><link rel="canonical" href="https://preview.example/"></html>',
    '404.html': '<html>Missing</html>', 'zh-hant/index.html': '<html lang="zh-Hant">你好</html>',
    'photos/harbor/index.html': '<html>Harbor</html>',
    'sitemap.xml': '<urlset/>', 'robots.txt': 'User-agent: *',
    'media/abc-640.webp': 'image fixture', 'assets/site.js': 'console.log("hello")',
    'assets/styles.css': 'body { color: white; }', 'fonts/site.woff2': 'font fixture',
    'manifest.json': '{"sourceId":"private-local-build-model"}',
  };
  for (const [key, body] of Object.entries(files)) {
    const filename = path.join(releaseDir, key);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, body);
  }
  return { root, releaseDir };
}

async function keysUnder(directory, relative = '') {
  const keys = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const key = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) keys.push(...await keysUnder(directory, key));
    else keys.push(key);
  }
  return keys.sort();
}

function fakeAWS(previous, { failOn, deleteErrors = [] } = {}) {
  const calls = [];
  const aws = async args => {
    const call = { args: [...args] };
    calls.push(call);
    if (failOn?.(args)) throw new Error('Simulated upload failure');
    if (args[0] === 's3api' && args[1] === 'get-object') {
      if (!previous) throw Object.assign(new Error('Missing object'), { stderr: 'An error occurred (NoSuchKey)' });
      await writeFile(args.at(-1), JSON.stringify(previous));
    } else if (args[0] === 's3' && args[1] === 'cp') {
      if (args.includes('--recursive')) call.keys = await keysUnder(args[2]);
      else call.body = JSON.parse(await readFile(args[2], 'utf8'));
    } else if (args[0] === 's3api' && args[1] === 'delete-objects') {
      call.request = JSON.parse(await readFile(args[args.indexOf('--delete') + 1].replace(/^file:\/\//, ''), 'utf8'));
      return JSON.stringify({ Errors: deleteErrors });
    } else throw new Error(`Unexpected AWS operation: ${args.slice(0, 2).join(' ')}`);
    return '{}';
  };
  return { aws, calls };
}

const options = (fixture, aws, extra = {}) => ({ releaseDir: fixture.releaseDir, target, aws, log() {}, ...extra });

test('deploy inventory excludes local build model and rejects incomplete, preview, and symlink releases', async t => {
  const f = await fixture(t);
  const { manifest } = await inventoryRelease(f.releaseDir, target);
  assert.equal(manifest.objects.length, 10);
  assert.ok(!manifest.objects.some(file => file.key === 'manifest.json'));
  assert.doesNotMatch(JSON.stringify(manifest), /private-local-build-model|sourceId|\/tmp\//);
  await writeFile(path.join(f.releaseDir, 'assets/site.js'), 'changed script');
  const updated = (await inventoryRelease(f.releaseDir, target)).manifest;
  assert.notEqual(updated.objects.find(file => file.key === 'assets/site.js').sha256, manifest.objects.find(file => file.key === 'assets/site.js').sha256);
  await symlink(path.join(f.releaseDir, 'index.html'), path.join(f.releaseDir, 'assets/escape.html'));
  await assert.rejects(inventoryRelease(f.releaseDir, target), /Symlink/);
  await rm(path.join(f.releaseDir, 'assets/escape.html'));
  await writeFile(path.join(f.releaseDir, 'photos/harbor/index.html'), '<html data-design-preview="true"></html>');
  await assert.rejects(inventoryRelease(f.releaseDir, target), /Design-preview/);
  await rm(path.join(f.releaseDir, 'photos/harbor/index.html'));
  await rm(path.join(f.releaseDir, '404.html'));
  await assert.rejects(inventoryRelease(f.releaseDir, target), /Incomplete release/);
});

test('deployment orders media and assets before pages, sets MIME/cache headers, then commits state', async t => {
  const f = await fixture(t);
  const mock = fakeAWS();
  const result = await deployRelease(options(f, mock.aws));
  assert.equal(result.uploads.length, 10);
  const batches = mock.calls.filter(call => call.keys);
  const keys = batches.flatMap(call => call.keys);
  assert.deepEqual(new Set(keys), new Set(result.manifest.objects.map(file => file.key)));
  assert.ok(!keys.includes('manifest.json'));
  assert.deepEqual(batches[0].keys, ['media/abc-640.webp']);
  const firstPage = batches.findIndex(call => call.keys.some(key => key.endsWith('.html') || key === 'robots.txt' || key === 'sitemap.xml'));
  assert.ok(firstPage > 1);
  assert.ok(batches.slice(firstPage).every(call => call.keys.every(key => key.endsWith('.html') || key === 'robots.txt' || key === 'sitemap.xml')));
  for (const call of batches) {
    assert.equal(call.args[3], `s3://${target.bucket}/`);
    assert.equal(call.args[call.args.indexOf('--cache-control') + 1], target.cacheControl);
    const contentType = call.args[call.args.indexOf('--content-type') + 1];
    for (const key of call.keys) assert.equal(contentType, result.manifest.objects.find(file => file.key === key).contentType);
    assert.ok(call.args.includes('--no-follow-symlinks'));
  }
  assert.equal(mock.calls.at(-1).args[3], `s3://${target.bucket}/_deploy/current.json`);
  assert.deepEqual(mock.calls.at(-1).body, result.manifest);
  assert.ok(!mock.calls.some(call => call.args[0] === 'cloudfront' || call.args.includes('--delete')));
});

test('unchanged deployment skips public files; cache policy migration or force replaces their metadata', async t => {
  const f = await fixture(t);
  const { manifest } = await inventoryRelease(f.releaseDir, target);
  assert.equal(createDeployPlan(manifest, manifest).uploads.length, 0);
  assert.equal(createDeployPlan(manifest, { ...manifest, cacheControl: 'max-age=31536000' }).uploads.length, manifest.objects.length);
  assert.equal(createDeployPlan(manifest, manifest, { force: true }).uploads.length, manifest.objects.length);
  const mock = fakeAWS(manifest);
  const result = await deployRelease(options(f, mock.aws));
  assert.equal(result.uploads.length, 0);
  assert.ok(!mock.calls.some(call => call.keys));
});

test('removed managed HTML is deleted only after uploads; old media and unrelated bucket files are retained', async t => {
  const f = await fixture(t);
  const { manifest: previous } = await inventoryRelease(f.releaseDir, target);
  await rm(path.join(f.releaseDir, 'photos/harbor/index.html'));
  await rm(path.join(f.releaseDir, 'media/abc-640.webp'));
  await writeFile(path.join(f.releaseDir, 'index.html'), '<link rel="canonical" href="https://preview.example/">Updated');
  const mock = fakeAWS(previous);
  const result = await deployRelease(options(f, mock.aws));
  assert.deepEqual(result.deleted, ['photos/harbor/index.html']);
  const removal = mock.calls.findIndex(call => call.request);
  assert.ok(removal > mock.calls.findIndex(call => call.keys));
  assert.deepEqual(mock.calls[removal].request.Objects, [{ Key: 'photos/harbor/index.html' }]);
  assert.ok(!mock.calls.some(call => call.args.includes('list-objects-v2') || call.args[0] === 's3' && call.args.includes('--delete')));
  assert.equal(mock.calls.at(-1).args[3], `s3://${target.bucket}/_deploy/current.json`);
});

test('failed asset upload leaves pages, deletes, and success records untouched', async t => {
  const f = await fixture(t);
  const mock = fakeAWS(undefined, { failOn: args => args.includes('text/javascript; charset=utf-8') });
  await assert.rejects(deployRelease(options(f, mock.aws)), /Simulated upload failure/);
  assert.ok(!mock.calls.some(call => call.keys?.some(key => key.endsWith('.html')) || call.request || call.body));
});

test('dry run and malformed prior manifest cannot mutate the bucket', async t => {
  const f = await fixture(t);
  const mock = fakeAWS();
  const result = await deployRelease(options(f, mock.aws, { dryRun: true }));
  assert.equal(result.dryRun, true);
  assert.equal(mock.calls.length, 1);
  const { manifest } = await inventoryRelease(f.releaseDir, target);
  for (const previous of [
    { ...manifest, bucket: 'other-bucket' },
    { ...manifest, objects: [...manifest.objects, manifest.objects[0]] },
    { ...manifest, objects: [{ key: '../private/index.html', sha256: 'a'.repeat(64) }] },
    { ...manifest, objects: [{ key: 'private.txt', sha256: 'a'.repeat(64) }] },
  ]) {
    const invalid = fakeAWS(previous);
    await assert.rejects(deployRelease(options(f, invalid.aws)), /Invalid/);
    assert.equal(invalid.calls.length, 1);
  }
});

test('access errors are not mistaken for absent state and partial deletion errors do not commit success', async t => {
  const f = await fixture(t);
  const denied = async () => { throw Object.assign(new Error('Access denied'), { stderr: 'An error occurred (AccessDenied)' }); };
  await assert.rejects(deployRelease(options(f, denied)), /Access denied/);
  const { manifest: previous } = await inventoryRelease(f.releaseDir, target);
  await rm(path.join(f.releaseDir, 'photos/harbor/index.html'));
  const mock = fakeAWS(previous, { deleteErrors: [{ Key: 'photos/harbor/index.html', Code: 'AccessDenied' }] });
  await assert.rejects(deployRelease(options(f, mock.aws)), /could not remove/);
  assert.ok(!mock.calls.some(call => call.body));
});

test('AWS CLI explicitly selects the configured profile and region without invoking CloudFront', async t => {
  const f = await fixture(t);
  const executable = path.join(f.root, 'aws');
  await writeFile(executable, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n');
  await chmod(executable, 0o700);
  const original = process.env.PATH;
  process.env.PATH = `${f.root}:${original}`;
  try {
    const args = JSON.parse(await awsCLI(target)(['s3api', 'list-objects-v2', '--bucket', target.bucket]));
    assert.equal(args[args.indexOf('--profile') + 1], target.profile);
    assert.equal(args[args.indexOf('--region') + 1], target.region);
    assert.ok(args.includes('--no-cli-pager'));
    assert.equal(args[0], 's3api');
  } finally { process.env.PATH = original; }
});
