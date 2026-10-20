import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCS, REFERENCE, SEQUENCE, pager, currentMark, pageContents } from '../src/docs-nav.ts';

const paths = (links) => links.map((l) => l.path);
const pair = (path, hasRound2) => {
  const { prev, next } = pager(path, hasRound2);
  return [prev?.path, next?.path];
};

test('page contents group subcommands under their parent without repeating the title', () => {
  const headings = [
    { depth: 1, slug: 'commands', text: 'Commands' },
    { depth: 2, slug: 'bs-prepare', text: 'bs prepare' },
    { depth: 2, slug: 'bs-refine', text: 'bs refine' },
    { depth: 3, slug: 'bs-refine-mask', text: 'bs refine mask' },
    { depth: 3, slug: 'bs-refine-morph', text: 'bs refine morph' },
    { depth: 2, slug: 'bs-utils', text: 'bs utils' },
    { depth: 3, slug: 'bs-utils-convert', text: 'bs utils convert' },
  ];
  assert.deepEqual(pageContents(headings), [
    { ...headings[1], children: [] },
    { ...headings[2], children: [headings[3], headings[4]] },
    { ...headings[5], children: [headings[6]] },
  ]);
});

test('reference pages are ordered Commands, Configuration, Input formats, Python API', () => {
  assert.deepEqual(REFERENCE.map((r) => r.label), ['Commands', 'Configuration', 'Input formats', 'Python API']);
});

test('the reading sequence covers every docs route once, in order', () => {
  assert.deepEqual(paths(SEQUENCE), [
    'docs/',
    'docs/install/',
    'docs/cremi/',
    'docs/cremi/round2/',
    'docs/your-data/',
    'docs/reference/',
    'docs/reference/cli/',
    'docs/reference/config/',
    'docs/reference/inputs/',
    'docs/reference/python/',
  ]);
  for (const link of [...DOCS, ...REFERENCE]) assert.ok(paths(SEQUENCE).includes(link.path), link.path);
});

test('previous and next follow the sequence and stop at both ends', () => {
  assert.deepEqual(pair('docs/', true), [undefined, 'docs/install/']);
  assert.deepEqual(pair('docs/cremi/', true), ['docs/install/', 'docs/cremi/round2/']);
  assert.deepEqual(pair('docs/cremi/round2/', true), ['docs/cremi/', 'docs/your-data/']);
  assert.deepEqual(pair('docs/reference/', true), ['docs/your-data/', 'docs/reference/cli/']);
  assert.deepEqual(pair('docs/reference/inputs/', true), ['docs/reference/config/', 'docs/reference/python/']);
  assert.deepEqual(pair('docs/reference/python/', true), ['docs/reference/inputs/', undefined]);
});

test('without the optional round 2 page, CREMI links straight to Your data', () => {
  assert.deepEqual(pair('docs/cremi/', false), ['docs/install/', 'docs/your-data/']);
  assert.deepEqual(pair('docs/your-data/', false), ['docs/cremi/', 'docs/reference/']);
  for (const link of SEQUENCE) {
    const { prev, next } = pager(link.path, false);
    assert.notEqual(prev?.path, 'docs/cremi/round2/');
    assert.notEqual(next?.path, 'docs/cremi/round2/');
  }
});

test('pager links carry the destination label', () => {
  const { prev, next } = pager('docs/reference/config/', true);
  assert.equal(prev.label, 'Commands');
  assert.equal(next.label, 'Input formats');
});

test('menus mark the exact page, and the CREMI parent while on round 2', () => {
  assert.equal(currentMark('docs/reference/cli/', 'docs/reference/cli/'), 'page');
  assert.equal(currentMark('docs/reference/cli/', 'docs/reference/config/'), undefined);
  assert.equal(currentMark('docs/reference/cli/', 'docs/reference/'), undefined);
  assert.equal(currentMark('docs/cremi/round2/', 'docs/cremi/'), 'location');
  assert.equal(currentMark('docs/cremi/', 'docs/cremi/'), 'page');
  assert.equal(currentMark('docs/', 'docs/install/'), undefined);
});
