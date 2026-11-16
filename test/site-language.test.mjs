import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../theme/assets/site.js', import.meta.url), 'utf8');

function visit({ pathname = '/', search = '', hash = '', languages = ['en-US'], storage = new Map(), referrer = '', navigation = 'navigate', blockedStorage = false } = {}) {
  const url = new URL(`https://dheera.net${pathname}${search}${hash}`);
  const redirects = [];
  const anchors = ['en', 'zh-Hant'].map(language => ({ dataset: { languageChoice: language }, handlers: {},
    addEventListener(event, handler) { this.handlers[event] = handler; },
  }));
  const location = { href: url.href, pathname: url.pathname, search: url.search, origin: url.origin,
    replace(destination) { redirects.push(destination); },
  };
  vm.runInNewContext(script, {
    URL, URLSearchParams, location,
    navigator: { languages, language: languages[0] },
    localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Blocked'); storage.set(key, value); },
    },
    performance: { getEntriesByType() { return [{ type: navigation }]; } },
    history: { replaceState() {} },
    document: {
      referrer, documentElement: { dataset: { style: 'midnight' } },
      querySelectorAll(selector) { return selector === '[data-language-choice]' ? anchors : []; },
      querySelector() { return null; },
    },
  });
  return { redirects, anchors, storage };
}

test('a fresh root entry chooses the first supported browser language', () => {
  assert.deepEqual(visit({ languages: ['zh-TW', 'en-US'] }).redirects, ['/zh-hant/']);
  assert.deepEqual(visit({ languages: ['en-US', 'zh-TW'] }).redirects, []);
  assert.deepEqual(visit({ languages: ['fr-FR', 'zh-Hans', 'en'] }).redirects, ['/zh-hant/']);
  assert.deepEqual(visit({ languages: ['fr-FR'] }).redirects, []);
});

test('explicit saved choices override the browser, including the previous preference key', () => {
  assert.deepEqual(visit({ languages: ['zh-TW'], storage: new Map([['dheera-language', 'en']]) }).redirects, []);
  assert.deepEqual(visit({ storage: new Map([['dheera-language', 'zh-Hant']]) }).redirects, ['/zh-hant/']);
  assert.deepEqual(visit({ storage: new Map([['gallery-language', 'zh-Hant']]) }).redirects, ['/zh-hant/']);
});

test('deep links, Chinese URLs, internal navigation, and Back are never redirected', () => {
  for (const pathname of ['/about/', '/photos/harbor/', '/projects/tool/', '/zh-hant/', '/zh-hant/photos/harbor/']) {
    assert.deepEqual(visit({ pathname, languages: ['zh-TW'], storage: new Map([['dheera-language', 'en']]) }).redirects, []);
  }
  assert.deepEqual(visit({ languages: ['zh-TW'], referrer: 'https://dheera.net/about/' }).redirects, []);
  assert.deepEqual(visit({ languages: ['zh-TW'], navigation: 'back_forward' }).redirects, []);
});

test('footer choices are saved before normal link navigation, including a middle click', () => {
  const page = visit({ pathname: '/zh-hant/' });
  page.anchors[0].handlers.click();
  assert.equal(page.storage.get('dheera-language'), 'en');
  assert.deepEqual(visit({ languages: ['zh-TW'], storage: page.storage }).redirects, []);
  page.anchors[1].handlers.auxclick({ button: 1 });
  assert.equal(page.storage.get('dheera-language'), 'zh-Hant');
  assert.deepEqual(visit({ storage: page.storage }).redirects, ['/zh-hant/']);
});

test('legacy root language parameters are explicit and redirects preserve unrelated URL state', () => {
  const chinese = visit({ search: '?lang=zh-Hant&ref=shared', hash: '#collections', storage: new Map([['dheera-language', 'en']]) });
  assert.deepEqual(chinese.redirects, ['/zh-hant/?ref=shared#collections']);
  assert.equal(chinese.storage.get('dheera-language'), 'zh-Hant');
  const english = visit({ search: '?lang=en', languages: ['zh-TW'] });
  assert.deepEqual(english.redirects, []);
  assert.equal(english.storage.get('dheera-language'), 'en');
});

test('blocked storage does not break preference detection or ordinary language links', () => {
  const page = visit({ languages: ['zh-TW'], blockedStorage: true });
  assert.deepEqual(page.redirects, ['/zh-hant/']);
  assert.doesNotThrow(() => page.anchors[0].handlers.click());
});
