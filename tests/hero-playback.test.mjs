import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (name) => readFileSync(new URL(`../src/components/${name}`, import.meta.url), 'utf8');
const hero = read('Hero.astro');
const [script] = [...hero.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const ORIGIN = 'http://local/sparsity/';

function boot({ theme, reduced, ready = true }) {
  const v = new EventTarget();
  v.dataset = { srcLight: '/header_light.mp4', srcDark: '/header_dark.mp4' };
  v.src = new URL(v.dataset.srcLight, ORIGIN).href;
  v.autoplay = true;
  v.currentTime = 0;
  v.duration = 10;
  v.pause = () => { v.paused = true; };
  v.play = () => { v.paused = false; return Promise.resolve(); };
  const attrs = new Map();
  let observe;
  const html = {
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute(name, value) { attrs.set(name, value); observe?.(); },
  };
  const document = new EventTarget();
  Object.assign(document, { documentElement: html, getElementById: () => v });
  class MutationObserver { constructor(cb) { this.cb = cb; } observe() { observe = this.cb; } }
  const motion = new EventTarget();
  motion.matches = reduced;
  const matchMedia = (q) => {
    assert.equal(q, '(prefers-reduced-motion: reduce)');
    return motion;
  };
  runInNewContext(script, { document, MutationObserver, matchMedia });
  html.setAttribute('data-theme', theme);
  if (ready) document.dispatchEvent(new Event('DOMContentLoaded'));
  return { v, html, motion };
}

test('the hero and napari videos autoplay muted in a loop with no controls', () => {
  for (const [file, id] of [['Hero.astro', 'hero-video'], ['Code.astro', 'napari-video']]) {
    const tag = read(file).match(new RegExp(`<video id="${id}"[^>]*>`))[0];
    for (const attr of ['autoplay', 'loop', 'muted', 'playsinline']) assert.match(tag, new RegExp(`\\s${attr}\\s`));
    assert.doesNotMatch(tag, /controls/);
  }
});

test('reduced motion turns autoplay off and other users keep it', () => {
  assert.equal(boot({ theme: 'light', reduced: true }).v.autoplay, false);
  const { v, motion } = boot({ theme: 'light', reduced: false });
  assert.equal(v.autoplay, true);
  v.currentTime = 3;
  motion.matches = true;
  motion.dispatchEvent(new Event('change'));
  assert.equal(v.autoplay, false);
  assert.equal(v.paused, true);
  assert.equal(v.currentTime, 0);
  motion.matches = false;
  motion.dispatchEvent(new Event('change'));
  assert.equal(v.autoplay, true);
  assert.equal(v.paused, false);
});

test('the source follows the theme and keeps the playback position', () => {
  assert.ok(boot({ theme: 'dark', reduced: false, ready: false }).v.src.endsWith('/header_dark.mp4'));
  const { v, html } = boot({ theme: 'dark', reduced: false });
  assert.ok(v.src.endsWith('/header_dark.mp4'));
  v.dispatchEvent(new Event('loadedmetadata'));
  v.currentTime = 12.5;
  html.setAttribute('data-theme', 'light');
  assert.ok(v.src.endsWith('/header_light.mp4'));
  v.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(v.currentTime, 2.5);
});
