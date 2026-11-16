// The pages are complete HTML. Language links work without JavaScript.
const languageStorageKey = 'dheera-language';

function supportedLanguage(value) {
  if (typeof value !== 'string') return null;
  if (/^en(?:-|$)/i.test(value)) return 'en';
  if (/^zh(?:-|$)/i.test(value)) return 'zh-Hant';
  return null;
}

function rememberLanguage(language) {
  try { localStorage.setItem(languageStorageKey, language); } catch (_) {}
}

document.querySelectorAll('[data-language-choice]').forEach(anchor => {
  const remember = () => rememberLanguage(anchor.dataset.languageChoice);
  anchor.addEventListener('click', remember);
  anchor.addEventListener('auxclick', event => { if (event.button === 1) remember(); });
});

function chooseRootLanguage() {
  // A shared deep link always opens its own language. Only a fresh root entry
  // negotiates a preference; internal navigation and Back remain predictable.
  if (location.pathname !== '/') return;
  const url = new URL(location.href);
  const explicit = supportedLanguage(url.searchParams.get('lang'));
  if (explicit) rememberLanguage(explicit);
  else {
    try { if (document.referrer && new URL(document.referrer).origin === location.origin) return; } catch (_) {}
    if (typeof performance !== 'undefined' && performance.getEntriesByType?.('navigation')[0]?.type === 'back_forward') return;
  }
  let preferred = explicit;
  if (!preferred) {
    try { preferred = supportedLanguage(localStorage.getItem(languageStorageKey)) || supportedLanguage(localStorage.getItem('gallery-language')); } catch (_) {}
  }
  if (!preferred) {
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
    preferred = languages.map(supportedLanguage).find(Boolean) || 'en';
  }
  if (preferred === 'zh-Hant') {
    url.pathname = '/zh-hant/';
    if (explicit) url.searchParams.delete('lang');
    location.replace(`${url.pathname}${url.search}${url.hash}`);
  }
}

chooseRootLanguage();

const styles = ['editorial', 'midnight', 'museum'];
const colors = { editorial: '#f4f1eb', midnight: '#151917', museum: '#ffffff' };

function applyStyle(style, writeURL = false) {
  if (!styles.includes(style)) return;
  document.documentElement.dataset.style = style;
  document.querySelectorAll('[data-style-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.styleChoice === style)));
  document.querySelector('meta[name="theme-color"]').content = colors[style];
  if (writeURL) {
    const url = new URL(location.href);
    url.searchParams.set('style', style);
    history.replaceState(null, '', url);
  }
  document.querySelectorAll('a[data-local-link]').forEach(anchor => {
    const url = new URL(anchor.href);
    url.searchParams.set('style', style);
    anchor.href = `${url.pathname}${url.search}${url.hash}`;
  });
}

document.querySelectorAll('[data-enhancement]').forEach(element => { element.hidden = false; });
if (document.documentElement.dataset.designPreview === 'true') {
  applyStyle(new URLSearchParams(location.search).get('style') || document.documentElement.dataset.style);
  document.querySelectorAll('[data-style-choice]').forEach(button => button.addEventListener('click', () => applyStyle(button.dataset.styleChoice, true)));
} else {
  // Published pages use the chosen theme and keep navigation URLs clean.
  const url = new URL(location.href);
  if (url.searchParams.has('style')) {
    url.searchParams.delete('style');
    history.replaceState(null, '', url);
  }
}

const gallery = document.querySelector('#photo-gallery');
document.querySelectorAll('[data-layout-choice]').forEach(button => button.addEventListener('click', () => {
  if (!gallery) return;
  gallery.dataset.layout = button.dataset.layoutChoice;
  document.querySelectorAll('[data-layout-choice]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
}));
