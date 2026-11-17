import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectTranslations, translateLibrary } from '../lib/local-translations.mjs';

async function fixture(t, unified = true) {
  const root = await mkdtemp('/tmp/dheera-local-translations-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'source');
  await mkdir(sourceDir);
  await writeFile(path.join(sourceDir, unified ? '.publish-library' : '.gallery-library'), JSON.stringify({ version: 1, id: 'translation-test' }));
  if (unified) {
    await mkdir(path.join(sourceDir, 'photos'));
    await mkdir(path.join(sourceDir, 'projects'));
  }
  const gallery = unified ? 'photos/harbor' : 'harbor';
  async function put(file, content) {
    await mkdir(path.dirname(path.join(sourceDir, file)), { recursive: true });
    await writeFile(path.join(sourceDir, file), content);
  }
  await put(`${gallery}/1.jpg`, 'scan fixture: image contents are not read');
  let counter = 0;
  async function translate(seeds, options = {}) {
    const seedPath = path.join(root, `seeds-${counter++}.json`);
    await writeFile(seedPath, JSON.stringify(seeds));
    return translateLibrary({ sourceDir, seedPath, ...options });
  }
  async function adapter(body) {
    const file = path.join(root, `adapter-${counter++}.mjs`);
    await writeFile(file, `#!${process.execPath}\nimport { writeFile } from 'node:fs/promises';\nlet input = ''; for await (const chunk of process.stdin) input += chunk;\nconst request = JSON.parse(input);\n${body}\n`, { mode: 0o755 });
    return file;
  }
  return { root, sourceDir, gallery, put, translate, adapter,
    read: file => readFile(path.join(sourceDir, file), 'utf8'),
    status: () => inspectTranslations({ sourceDir }),
  };
}

test('status reads only authored active text and never writes or invokes an adapter', async t => {
  const f = await fixture(t);
  await f.put(`${f.gallery}/1.md`, 'A quiet harbor.');
  await f.put(`${f.gallery}/deleted-photo.md`, 'This image is gone.');
  await f.put('projects/draft/project.md', '---\ndraft: true\ntitle: Draft project\n---\nDo not translate.');
  await f.put('projects/code/project.md', '---\ntitle: Code project\ngithub: https://github.com/example/code\n---\n');
  const report = await translateLibrary({ sourceDir: f.sourceDir, statusOnly: true, translatorCommand: '/missing/executable' });
  assert.equal(report.counts.missing, 2);
  assert.deepEqual(report.details.map(detail => detail.field), ['body', 'title']);
  assert.deepEqual(report.changedFiles, []);
  assert(!((await readdir(f.sourceDir)).includes('.translations')));
  await assert.rejects(f.read(`${f.gallery}/1.zh-Hant.md`), { code: 'ENOENT' });
});

test('explicit translation materializes editable sidecars without copying shared metadata', async t => {
  const f = await fixture(t);
  await f.put(`${f.gallery}/gallery.md`, '---\ntitle: Harbor\nslug: harbor\nlayout: exhibition\ncover: 1.jpg\n---\nThe shore.');
  await f.put(`${f.gallery}/1.md`, '---\ntitle: Boats\nalt: Boats at dusk.\norder: 2\n---\nA quiet harbor.');
  const report = await f.translate({ Harbor: '海港', 'The shore.': '岸邊。', Boats: '船隻', 'Boats at dusk.': '暮色中的船隻。', 'A quiet harbor.': '寧靜的海港。' });
  assert.equal(report.counts.generated, 5);
  assert.equal(report.counts.missing, 0);
  assert.deepEqual(report.changedFiles, [`${f.gallery}/gallery.zh-Hant.md`, `${f.gallery}/1.zh-Hant.md`]);
  const gallery = await f.read(`${f.gallery}/gallery.zh-Hant.md`);
  assert.match(gallery, /title: 海港/);
  assert.match(gallery, /岸邊。/);
  assert.doesNotMatch(gallery, /slug:|layout:|cover:/);
  const photo = await f.read(`${f.gallery}/1.zh-Hant.md`);
  assert.match(photo, /暮色中的船隻。/);
  assert.doesNotMatch(photo, /order:/);
  const state = JSON.parse(await f.read('.translations/state.json'));
  assert.equal(state.records[`${f.gallery}/1.zh-Hant.md`].body.owner, 'generated');
  assert.match(state.records[`${f.gallery}/1.zh-Hant.md`].body.generatedHash, /^[a-f0-9]{64}$/);
  const unchanged = await f.translate({});
  assert.equal(unchanged.counts.generated, 0);
  assert.deepEqual(unchanged.changedFiles, []);
});

test('English edits only report stale Chinese; translation fills it again after explicit deletion', async t => {
  const f = await fixture(t);
  await f.put(`${f.gallery}/1.md`, 'A quiet harbor.');
  await f.translate({ 'A quiet harbor.': '寧靜的海港。' });
  const original = await f.read(`${f.gallery}/1.zh-Hant.md`);
  await f.put(`${f.gallery}/1.md`, 'Boats leave at dawn.');
  const status = await f.status();
  assert.equal(status.counts.stale, 1);
  assert.equal(await f.read(`${f.gallery}/1.zh-Hant.md`), original);
  const preserved = await f.translate({});
  assert.equal(preserved.counts.stale, 1);
  assert.equal(preserved.counts.generated, 0);
  assert.equal(await f.read(`${f.gallery}/1.zh-Hant.md`), original);
  await f.put(`${f.gallery}/1.zh-Hant.md`, '');
  const updated = await f.translate({ 'Boats leave at dawn.': '船隻在黎明時出港。' });
  assert.equal(updated.counts.generated, 1);
  assert.equal(updated.counts.stale, 0);
  assert.match(await f.read(`${f.gallery}/1.zh-Hant.md`), /船隻在黎明時出港。/);
});

test('gallery subtitles use missing-only translation and preserve existing Chinese after English changes', async t => {
  const f = await fixture(t);
  await f.put(`${f.gallery}/gallery.md`, '---\nsubtitle: A landscape measured in heat\n---\n');
  const generated = await f.translate({ 'A landscape measured in heat': '以熱量描繪的地景' });
  assert.equal(generated.counts.generated, 1);
  const original = await f.read(`${f.gallery}/gallery.zh-Hant.md`);
  assert.match(original, /subtitle: 以熱量描繪的地景/);
  await f.put(`${f.gallery}/gallery.md`, '---\nsubtitle: The warmth beneath the ice\n---\n');
  const preserved = await f.translate({ 'The warmth beneath the ice': '不能覆蓋既有翻譯' });
  assert.equal(preserved.counts.generated, 0);
  assert.equal(preserved.counts.stale, 1);
  assert.equal(preserved.details.find(detail => detail.status === 'stale')?.field, 'subtitle');
  assert.equal(await f.read(`${f.gallery}/gallery.zh-Hant.md`), original);
  await f.put(`${f.gallery}/gallery.zh-Hant.md`, '---\nsubtitle: 我自己修改的副標題\n---\n');
  const edited = await f.translate({ 'The warmth beneath the ice': '也不能覆蓋手寫文字' });
  assert.equal(edited.counts.generated, 0);
  assert.equal(edited.counts.manual, 1);
  assert.match(await f.read(`${f.gallery}/gallery.zh-Hant.md`), /subtitle: 我自己修改的副標題/);
});

test('hand-edited Chinese is preserved, marked stale on source changes, and can be acknowledged', async t => {
  const f = await fixture(t);
  await f.put(`${f.gallery}/1.md`, 'A quiet harbor.');
  await f.translate({ 'A quiet harbor.': '寧靜的海港。' });
  await f.put(`${f.gallery}/1.zh-Hant.md`, '我親自寫的中文。\n');
  await f.put(`${f.gallery}/1.md`, 'Boats leave at dawn.');
  const before = await f.status();
  assert.equal(before.counts.manual, 1);
  assert.equal(before.counts.stale, 1);
  const preserved = await f.translate({ 'Boats leave at dawn.': '不要覆蓋。' });
  assert.deepEqual(preserved.changedFiles, []);
  assert.equal(preserved.counts.conflicts, 1);
  assert.equal(await f.read(`${f.gallery}/1.zh-Hant.md`), '我親自寫的中文。\n');
  const reviewed = await f.translate({}, { acceptReviewed: true });
  assert.equal(reviewed.counts.stale, 0);
  assert.equal(reviewed.counts.conflicts, 0);
  assert.equal(reviewed.counts.manual, 1);
});

test('partial untracked manual overrides preserve comments and unknown metadata', async t => {
  const f = await fixture(t);
  await f.put('projects/tool/project.md', '---\ntitle: Tool\nsummary: A useful tool.\ngithub: https://github.com/example/tool\n---\nHow it works.');
  await f.put('projects/tool/project.zh-Hant.md', '---\n# My chosen title\ntitle: 手寫標題 # keep this comment\ncustom: retained # editor note\n---\n');
  const report = await f.translate({ 'A useful tool.': '實用的工具。', 'How it works.': '運作方式。' });
  const actual = await f.read('projects/tool/project.zh-Hant.md');
  assert.match(actual, /手寫標題/);
  assert.match(actual, /# My chosen title/);
  assert.match(actual, /# keep this comment/);
  assert.match(actual, /custom: retained # editor note/);
  assert.match(actual, /summary: 實用的工具。/);
  assert.match(actual, /運作方式。/);
  assert.equal(report.counts.manual, 1);
  assert.equal(report.counts.generated, 2);
  await f.put('projects/tool/project.md', '---\ntitle: Revised tool\nsummary: A useful tool.\ngithub: https://github.com/example/tool\n---\nHow it works.');
  assert.equal((await f.status()).counts.stale, 1);
});

test('deleted English captions and source fields preserve Chinese without requesting new text', async t => {
  const f = await fixture(t);
  await f.put(`${f.gallery}/1.md`, '---\ntitle: Boats\n---\nA quiet harbor.');
  await f.translate({ Boats: '船隻', 'A quiet harbor.': '寧靜的海港。' });
  const original = await f.read(`${f.gallery}/1.zh-Hant.md`);
  await f.put(`${f.gallery}/1.md`, '---\ntitle: Boats\n---\n');
  assert.equal((await f.status()).counts.obsolete, 1);
  const result = await f.translate({});
  assert.equal(result.counts.generated, 0);
  assert.equal(await f.read(`${f.gallery}/1.zh-Hant.md`), original);
  await rm(path.join(f.sourceDir, `${f.gallery}/1.md`));
  await f.translate({});
  assert.equal(await f.read(`${f.gallery}/1.zh-Hant.md`), original);
  const again = await f.translate({ 'A quiet harbor.': '不能復活。' });
  assert.equal(again.counts.generated, 0);
  assert.equal(again.counts.obsolete, 2);
});

test('deleting generated Chinese locally makes that field eligible for explicit generation', async t => {
  const f = await fixture(t);
  await f.put(`${f.gallery}/1.md`, 'A quiet harbor.');
  await f.translate({ 'A quiet harbor.': '寧靜的海港。' });
  await f.put(`${f.gallery}/1.zh-Hant.md`, '');
  const report = await f.translate({ 'A quiet harbor.': '重新翻譯。' });
  assert.equal(report.counts.conflicts, 0);
  assert.equal(report.counts.generated, 1);
  assert.match(await f.read(`${f.gallery}/1.zh-Hant.md`), /重新翻譯。/);
});

test('adapter errors and invalid proposals leave all sidecars and state untouched', async t => {
  const f = await fixture(t);
  await f.put(`${f.gallery}/1.md`, 'First caption.');
  await f.put(`${f.gallery}/2.jpg`, 'image');
  await f.put(`${f.gallery}/2.md`, 'Read [the page](https://example.com/) and run `command()`.');
  const broken = await f.adapter("process.stdout.write('not JSON');");
  await assert.rejects(translateLibrary({ sourceDir: f.sourceDir, translatorCommand: broken }), /must return JSON/);
  const invalid = await f.adapter("process.stdout.write(JSON.stringify({translations:Object.fromEntries(request.items.map(item=>[item.id, '中文但連結不見了。']))}));");
  await assert.rejects(translateLibrary({ sourceDir: f.sourceDir, translatorCommand: invalid }), /changed Markdown links/);
  await assert.rejects(f.read(`${f.gallery}/1.zh-Hant.md`), { code: 'ENOENT' });
  await assert.rejects(f.read(`${f.gallery}/2.zh-Hant.md`), { code: 'ENOENT' });
  await assert.rejects(f.read('.translations/state.json'), { code: 'ENOENT' });
  assert(!((await readdir(f.sourceDir)).includes('.translations')));
  const success = await f.adapter("if (!request.items.every(item=>item.context.sourceFile && item.context.document)) throw new Error('Missing context'); process.stdout.write(JSON.stringify({translations:Object.fromEntries(request.items.map(item=>[item.id, '中文：' + item.text]))}));");
  const result = await translateLibrary({ sourceDir: f.sourceDir, translatorCommand: success });
  assert.equal(result.counts.generated, 2);
  assert.match(await f.read(`${f.gallery}/2.zh-Hant.md`), /https:\/\/example.com/);
});

test('sidecar edits made while the translator runs are not overwritten', async t => {
  const f = await fixture(t);
  await f.put(`${f.gallery}/1.md`, 'A caption.');
  const target = path.join(f.sourceDir, `${f.gallery}/1.zh-Hant.md`);
  const adapter = await f.adapter(`await writeFile(${JSON.stringify(target)}, 'My concurrent edit.'); process.stdout.write(JSON.stringify({translations:Object.fromEntries(request.items.map(item=>[item.id, '中文圖說。']))}));`);
  await assert.rejects(translateLibrary({ sourceDir: f.sourceDir, translatorCommand: adapter }), /changed while translations/);
  assert.equal(await f.read(`${f.gallery}/1.zh-Hant.md`), 'My concurrent edit.');
  await assert.rejects(f.read('.translations/state.json'), { code: 'ENOENT' });
});

test('translation batches are bounded and a later batch failure cannot partially write earlier results', async t => {
  const f = await fixture(t);
  for (let number = 1; number <= 41; number++) {
    await f.put(`${f.gallery}/${number}.jpg`, 'image');
    await f.put(`${f.gallery}/${number}.md`, `Caption ${number}.`);
  }
  const failing = await f.adapter("if(request.items.length > 40) throw new Error('Batch too large'); process.stdout.write(JSON.stringify({translations:request.items.length === 40 ? Object.fromEntries(request.items.map(item=>[item.id, '中文：' + item.text])) : {}}));");
  await assert.rejects(translateLibrary({ sourceDir: f.sourceDir, translatorCommand: failing }), /Translation missing/);
  const files = await readdir(path.join(f.sourceDir, f.gallery));
  assert.equal(files.filter(file => file.endsWith('.zh-Hant.md')).length, 0);
  await assert.rejects(f.read('.translations/state.json'), { code: 'ENOENT' });
  const calls = path.join(f.root, 'batch-sizes.txt');
  const success = await f.adapter(`if(request.items.length > 40) throw new Error('Batch too large'); const {appendFile} = await import('node:fs/promises'); await appendFile(${JSON.stringify(calls)}, String(request.items.length) + '\\n'); process.stdout.write(JSON.stringify({translations:Object.fromEntries(request.items.map(item=>[item.id, '中文：' + item.text]))}));`);
  const result = await translateLibrary({ sourceDir: f.sourceDir, translatorCommand: success });
  assert.equal(result.counts.generated, 41);
  assert.equal(await readFile(calls, 'utf8'), '40\n1\n');
});

test('missing markers and escaping symlink destinations are rejected', async t => {
  const f = await fixture(t);
  await f.put(`${f.gallery}/1.md`, 'A caption.');
  const outside = path.join(f.root, 'outside.md');
  await writeFile(outside, 'Unrelated file.');
  await symlink(outside, path.join(f.sourceDir, `${f.gallery}/1.zh-Hant.md`));
  await assert.rejects(f.translate({ 'A caption.': '圖說。' }), /cannot be symlinks/);
  assert.equal(await readFile(outside, 'utf8'), 'Unrelated file.');
  await rm(path.join(f.sourceDir, `${f.gallery}/1.zh-Hant.md`));
  await rm(path.join(f.sourceDir, '.publish-library'));
  await assert.rejects(f.status(), /missing a library marker/);
});

test('legacy libraries can materialize prior hash-keyed cached translations without an adapter', async t => {
  const f = await fixture(t, false);
  const text = 'An earlier caption.';
  await f.put(`${f.gallery}/1.md`, text);
  const cachePath = path.join(f.root, 'old-cache.json');
  const key = createHash('sha256').update(`zh-Hant\0${text}`).digest('hex');
  await writeFile(cachePath, JSON.stringify({ [key]: '先前的圖說。' }));
  const report = await translateLibrary({ sourceDir: f.sourceDir, cachePath });
  assert.equal(report.counts.generated, 1);
  assert.match(await f.read(`${f.gallery}/1.zh-Hant.md`), /先前的圖說。/);
});

test('paired galleries fill nested translations while preserving authored text, comments, and shared metadata', async t => {
  const f = await fixture(t);
  const pair = `${f.gallery}/01-bridge`;
  await f.put(`${f.gallery}/gallery.md`, '---\nlayout: pairs\ntitle: City pairs\n---\n');
  await f.put(`${pair}/a.jpg`, 'image');
  await f.put(`${pair}/b.jpg`, 'image');
  const source = '---\ntitle: Bridge\norder: 3\na:\n  label: Day\n  alt: A bridge in sunlight.\nb:\n  label: Night\n  alt: A bridge with lights.\n---\nUnknown · [Dheera](https://dheera.net/).';
  await f.put(`${pair}/pair.md`, source);
  await f.put(`${pair}/pair.zh-Hant.md`, '---\n# My pair title\ntitle: 我的橋\na:\n  label: 白晝 # keep my wording\n  custom: retained\nb:\n  custom: retained too # preserve this\n---\n');
  const result = await f.translate({ 'City pairs': '城市對照', 'A bridge in sunlight.': '陽光下的橋。', Night: '夜晚',
    'A bridge with lights.': '點燈的橋。', 'Unknown · [Dheera](https://dheera.net/).': '作者不詳 · [Dheera](https://dheera.net/)。' });
  assert.equal(result.counts.generated, 5);
  assert.equal(result.counts.missing, 0);
  const saved = await f.read(`${pair}/pair.zh-Hant.md`);
  assert.match(saved, /# My pair title\ntitle: 我的橋/);
  assert.match(saved, /label: 白晝 # keep my wording/);
  assert.match(saved, /a:\n  label: 白晝[^\n]*\n  custom: retained\n  alt: 陽光下的橋。/);
  assert.match(saved, /b:\n  custom: retained too # preserve this\n  label: 夜晚\n  alt: 點燈的橋。/);
  assert.match(saved, /作者不詳 · \[Dheera\]\(https:\/\/dheera.net\/\)。/);
  assert.doesNotMatch(saved, /order:|a\.label:|b\.label:|credit:/);
  const state = JSON.parse(await f.read('.translations/state.json'));
  assert.equal(state.records[`${pair}/pair.zh-Hant.md`]['a.alt'].owner, 'generated');
  assert.equal(state.records[`${pair}/pair.zh-Hant.md`]['a.label'].owner, 'manual');
  assert.deepEqual((await f.translate({})).changedFiles, []);

  await f.put(`${pair}/pair.md`, source.replace('label: Day', 'label: Morning').replace('label: Night', 'label: Dusk'));
  const stale = await f.translate({});
  assert.equal(stale.counts.stale, 2);
  assert.equal(stale.counts.generated, 0);
  assert.equal(await f.read(`${pair}/pair.zh-Hant.md`), saved);
  await f.put(`${pair}/pair.zh-Hant.md`, saved.replace('  label: 夜晚\n', ''));
  const filled = await f.translate({ Dusk: '黃昏' });
  assert.equal(filled.counts.generated, 1);
  assert.match(await f.read(`${pair}/pair.zh-Hant.md`), /label: 黃昏/);
  assert.match(await f.read(`${pair}/pair.zh-Hant.md`), /label: 白晝 # keep my wording/);
});

test('pair sidecars are optional and original images, unrelated images, and their sidecars are ignored', async t => {
  const f = await fixture(t);
  const pair = `${f.gallery}/01-bridge`;
  await f.put(`${f.gallery}/gallery.md`, '---\nlayout: pairs\n---\n');
  await f.put(`${f.gallery}/1.md`, '---\nnot valid: [\n---\n');
  await f.put(`${pair}/A.JPG`, 'image');
  await f.put(`${pair}/b.png`, 'image');
  await f.put(`${pair}/original.jpg`, 'original composite');
  await f.put(`${pair}/original.md`, '---\nnot valid: [\n---\n');
  await f.put(`${pair}/extra.jpg`, 'unrelated image');
  await f.put(`${pair}/extra.md`, 'Do not translate.');
  await f.put(`${pair}/a.md`, 'Pair metadata belongs in pair.md, not here.');
  const result = await f.translate({});
  assert.equal(result.counts.missing, 0);
  assert.equal(result.counts.generated, 0);
  assert.deepEqual(result.details, []);
  await assert.rejects(f.read(`${pair}/pair.zh-Hant.md`), { code: 'ENOENT' });
  await assert.rejects(f.read(`${pair}/original.zh-Hant.md`), { code: 'ENOENT' });
});

test('pair scanning rejects ambiguous or incomplete images and unsafe nested sidecar paths', async t => {
  const f = await fixture(t);
  const pair = `${f.gallery}/01-bridge`;
  await f.put(`${f.gallery}/gallery.md`, '---\nlayout: pairs\n---\n');
  await f.put(`${pair}/a.jpg`, 'image');
  await f.put(`${pair}/pair.md`, '---\na:\n  label: Day\n---\n');
  await assert.rejects(f.status(), /require one a image and one b image/);
  await f.put(`${pair}/b.jpg`, 'image');
  await f.put(`${pair}/a.png`, 'image');
  await assert.rejects(f.status(), /duplicate a image/);
  await rm(path.join(f.sourceDir, pair, 'a.png'));
  const outside = path.join(f.root, 'outside-pair.md');
  await writeFile(outside, 'Unrelated content.');
  await symlink(outside, path.join(f.sourceDir, pair, 'pair.zh-Hant.md'));
  await assert.rejects(f.translate({ Day: '白天' }), /cannot be symlinks/);
  assert.equal(await readFile(outside, 'utf8'), 'Unrelated content.');
  await rm(path.join(f.sourceDir, pair, 'pair.zh-Hant.md'));
  await f.put(`${pair}/pair.zh-Hant.md`, '---\na: 手寫文字\n---\n');
  await assert.rejects(f.translate({ Day: '白天' }), /a must be a mapping/);
  await f.put(`${pair}/pair.zh-Hant.md`, '---\na:\n  label: 12\n---\n');
  await assert.rejects(f.translate({ Day: '白天' }), /a.label must be text/);
  await f.put(`${pair}/pair.zh-Hant.md`, '');
  await rm(path.join(f.sourceDir, pair, 'a.jpg'));
  await symlink(outside, path.join(f.sourceDir, pair, 'a.jpg'));
  await assert.rejects(f.status(), /cannot be symlinks/);
});
