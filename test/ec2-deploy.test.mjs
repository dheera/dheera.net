import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readlink, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { validateEC2Target, deployEC2, remoteScript, sshArguments } from '../deploy-ec2.mjs';

const target = { host: 'ubuntu@example.com', siteURL: 'https://example.com', directory: '/var/www/example.com' };

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dheera-ec2-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function python(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.end(script);
  });
}

test('EC2 target validation rejects shell syntax and SSH keeps host verification enabled', () => {
  assert.equal(validateEC2Target(target), target);
  for (const host of ['-oProxyCommand=bad', 'ubuntu@example.com;bad', 'ubuntu@example.com/x']) {
    assert.throws(() => validateEC2Target({ ...target, host }));
  }
  for (const directory of ['/', '/var/www/../etc', '/var//www', '/var/www/a;bad']) {
    assert.throws(() => validateEC2Target({ ...target, directory }));
  }
  assert.throws(() => validateEC2Target({ ...target, siteURL: 'http://example.com' }));
  assert.deepEqual(sshArguments('/private/key'), ['-F', '/dev/null', '-i', '/private/key', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15']);
});

test('dry run inventories only public output without SSH and rejects design preview', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'zh-hant'));
  await writeFile(path.join(root, 'index.html'), '<link rel="canonical" href="https://example.com/">');
  await writeFile(path.join(root, 'zh-hant/index.html'), '<html lang="zh-Hant"></html>');
  await writeFile(path.join(root, '404.html'), 'Not found');
  await writeFile(path.join(root, 'sitemap.xml'), '<urlset/>');
  await writeFile(path.join(root, 'robots.txt'), 'User-agent: *');
  await writeFile(path.join(root, 'manifest.json'), '{"privateSource":"do not upload"}');
  const plan = await deployEC2({ target, releaseDir: root, identity: '/nonexistent/key', dryRun: true, log: () => {} });
  assert.equal(plan.dryRun, true);
  assert.equal(plan.objects.length, 5);
  assert.ok(plan.objects.every(file => file.key !== 'manifest.json'));
  await writeFile(path.join(root, '404.html'), '<div data-design-preview="true"></div>');
  await assert.rejects(deployEC2({ target, releaseDir: root, dryRun: true, log: () => {} }), /Design-preview/);
});

test('remote activation verifies exact uploaded bytes and preserves the active release on failure', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'releases', 'old'), { recursive: true });
  await symlink('releases/old', path.join(root, 'current'));
  const bytes = Buffer.from('<h1>New release</h1>');
  const payload = { directory: root, release: 'next', objects: [{ key: 'index.html', sha256: createHash('sha256').update(bytes).digest('hex') }] };
  await python(remoteScript('prepare', payload));
  await writeFile(path.join(root, 'releases/next/index.html'), 'truncated upload');
  await assert.rejects(python(remoteScript('activate', payload)), /checksum mismatch/);
  assert.equal(await readlink(path.join(root, 'current')), 'releases/old');
  await writeFile(path.join(root, 'releases/next/index.html'), bytes);
  await writeFile(path.join(root, 'releases/next/unexpected.txt'), 'unexpected');
  await assert.rejects(python(remoteScript('activate', payload)), /Unexpected file/);
  assert.equal(await readlink(path.join(root, 'current')), 'releases/old');
  await rm(path.join(root, 'releases/next/unexpected.txt'));
  const activated = JSON.parse(await python(remoteScript('activate', payload)));
  assert.equal(activated.previous, 'releases/old');
  assert.equal(activated.verifiedFiles, 1);
  assert.equal(await readlink(path.join(root, 'current')), 'releases/next');
  await python(remoteScript('unlock', payload));
  await assert.rejects(stat(path.join(root, '.deploy-lock')), { code: 'ENOENT' });
});
