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
