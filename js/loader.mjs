// Reusable Ahaji loader and image skeleton helpers. Static pages use the same
// markup directly in HTML so the loader appears before any script runs.
const ANIMATED = 'images/loader/ahaji-loader.svg';
const STILL = 'images/loader/ahaji-loader-reduced.svg';

export function createLoader({ label = '', variant = 'section', size } = {}) {
  const root = document.createElement('div');
  root.className = `ahaji-loader ahaji-loader--${variant}`;
  root.dataset.loader = '';
  root.setAttribute('role', 'status');
  if (size) root.style.setProperty('--loader-size', `${size}px`);
  const mark = document.createElement('picture');
  mark.className = 'ahaji-loader__mark';
  mark.setAttribute('aria-hidden', 'true');
  const still = document.createElement('source');
  still.srcset = STILL;
  still.media = '(prefers-reduced-motion: reduce)';
  const img = document.createElement('img');
  img.src = ANIMATED;
  img.alt = '';
  img.width = 96;
  img.height = 86;
  img.decoding = 'async';
  mark.append(still, img);
  const text = document.createElement('span');
  text.className = label ? 'ahaji-loader__label' : 'ahaji-loader__sr';
  text.textContent = label || 'جارٍ التحميل…';
  root.append(mark, text);
  return root;
}

// Shows a skeleton behind an image until it has loaded or failed.
export function withImageSkeleton(img, frame) {
  if (!img || img.tagName !== 'IMG') return img;
  const done = () => {
    img.classList.remove('is-loading');
    frame.classList.remove('image-skeleton');
  };
  if (img.complete && img.naturalWidth) return img;
  frame.classList.add('image-skeleton');
  img.classList.add('is-loading');
  img.addEventListener('load', done, { once: true });
  img.addEventListener('error', done, { once: true });
  return img;
}

// Starts loading images through the normal pipeline so later <img> elements
// with the same URL reuse the cached response instead of downloading again.
const preloaded = new Map();
export function preloadImages(urls) {
  for (const src of urls) {
    if (!src || preloaded.has(src)) continue;
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'high';
    img.src = src;
    preloaded.set(src, img);
  }
}

// Resolves once an image has loaded and decoded, or has definitively failed.
// A pending retry (src replaced, not yet complete) keeps waiting; a broken
// image replaced by a fallback element counts as settled.
function imageSettled(img) {
  return new Promise(resolve => {
    const decode = () => (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(finish);
    const onError = () => queueMicrotask(() => { if (img.isConnected && !img.complete) return; finish(); });
    function finish() {
      img.removeEventListener('load', decode);
      img.removeEventListener('error', onError);
      resolve();
    }
    if (img.complete) { img.naturalWidth ? decode() : finish(); return; }
    img.addEventListener('load', decode);
    img.addEventListener('error', onError);
  });
}

export async function waitForImages(images, timeoutMs) {
  if (!images.length) return { timedOut: false };
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(true), timeoutMs); });
  const timedOut = await Promise.race([Promise.all(images.map(imageSettled)).then(() => false), timeout]);
  clearTimeout(timer);
  return { timedOut };
}

export function visibleImages(root) {
  return [...root.querySelectorAll('img')].filter(img => {
    const box = img.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight &&
      box.right > 0 && box.left < innerWidth;
  });
}

// Hides a page gate with one short fade and makes the revealed content usable.
export function revealPage(gate, content) {
  if (content) { content.inert = false; content.removeAttribute('aria-busy'); }
  if (gate.hidden) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { gate.hidden = true; return; }
  gate.classList.add('is-leaving');
  const done = () => {
    if (!gate.classList.contains('is-leaving')) return;
    gate.hidden = true; gate.classList.remove('is-leaving');
  };
  gate.addEventListener('animationend', done, { once: true });
  setTimeout(done, 260);
}

// Shows a page gate again (e.g. while verifying), cancelling any fade in progress.
export function showPageGate(gate) {
  gate.classList.remove('is-leaving');
  gate.hidden = false;
}
