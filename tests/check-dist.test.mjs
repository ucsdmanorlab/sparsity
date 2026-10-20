import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkDist } from '../scripts/check-dist.mjs';

const page = (route, body, canonical = `https://ucsdmanorlab.github.io/sparsity/${route}`) =>
  `<html><head><link rel="canonical" href="${canonical}"></head><body>${body}</body></html>`;

function dist(files) {
  const root = mkdtempSync(join(tmpdir(), 'dist-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const good = {
  'index.html': page('', '<h1>Paper</h1><a href="/sparsity/docs/">Docs</a><img src="/sparsity/fig.png">'),
  'fig.png': 'png',
  'docs/index.html': page('docs/', '<h1 id="top">Docs</h1><a href="/sparsity/docs/cli/#bs-prepare">x</a><a href="#top">t</a><a href="https://example.org/">e</a>'),
  'docs/cli/index.html': page('docs/cli/', '<h1>Commands</h1><h2 id="bs-prepare">bs prepare</h2>'),
};

test('a consistent build has no problems', () => {
  assert.deepEqual(checkDist(dist(good)), []);
});

test('a broken local link, a missing anchor, two h1s and a wrong canonical are each reported', () => {
  const problems = checkDist(dist({
    ...good,
    'docs/index.html': page('docs/', '<h1>Docs</h1><h1>Again</h1><a href="/sparsity/docs/cli/#bs-run">x</a><img src="/sparsity/missing.webp">', 'https://ucsdmanorlab.github.io/sparsity/'),
  }));
  assert.deepEqual(problems.sort(), [
    'docs/index.html: 2 h1 elements',
    'docs/index.html: canonical https://ucsdmanorlab.github.io/sparsity/ is not https://ucsdmanorlab.github.io/sparsity/docs/',
    'docs/index.html: missing anchor /sparsity/docs/cli/#bs-run',
    'docs/index.html: missing target /sparsity/missing.webp',
  ]);
});

test('a root-relative link that skips the /sparsity base is reported', () => {
  const problems = checkDist(dist({ ...good, 'index.html': page('', '<h1>Paper</h1><a href="/docs/">Docs</a>') }));
  assert.deepEqual(problems, ['index.html: link outside /sparsity: /docs/']);
});

test('a CLI flag turned into a dash by smart punctuation is reported', () => {
  const problems = checkDist(dist({ ...good, 'docs/cli/index.html': page('docs/cli/', '<h1>Commands</h1><h2 id="bs-prepare">x</h2><p>Example: \u2014raw data.zarr</p>') }));
  assert.deepEqual(problems, ['docs/cli/index.html: dash before a flag name: \u2014raw']);
});
