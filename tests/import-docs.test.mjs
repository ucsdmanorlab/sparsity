import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { PAGES, rewriteMarkdown, importDocs } from '../scripts/import-docs.mjs';

const pageSources = new Map(PAGES.map((p) => [p.source, p.route]));

test('pages map the approved Bootstrapper sources to the approved routes', () => {
  assert.deepEqual(Object.fromEntries(pageSources), {
    'docs/install.md': 'install',
    'examples/cremi/README.md': 'cremi',
    'examples/cremi/round2.md': 'cremi/round2',
    'docs/inputs.md': 'your-data',
    'docs/cli.md': 'reference/cli',
    'docs/config.md': 'reference/config',
    'docs/python.md': 'reference/python',
    'docs/input-formats.md': 'reference/inputs',
  });
});

const rewrite = (md, source, ref) => rewriteMarkdown(md, source, { pages: pageSources, ref });

test('a link to an imported page becomes its /sparsity route and keeps the anchor', () => {
  const { markdown } = rewrite('See [prepare](cli.md#bs-prepare) and [config](config.md).', 'docs/python.md');
  assert.equal(markdown, 'See [prepare](/sparsity/docs/reference/cli/#bs-prepare) and [config](/sparsity/docs/reference/config/).');
});

test('a link that climbs out of examples/cremi resolves against the repository root', () => {
  const { markdown } = rewrite('[inputs](../../docs/inputs.md) [round 2](round2.md)', 'examples/cremi/README.md');
  assert.equal(markdown, '[inputs](/sparsity/docs/your-data/) [round 2](/sparsity/docs/cremi/round2/)');
});

test('an image becomes a /sparsity media URL and is listed for copying', () => {
  const { markdown, assets } = rewrite('![raw and labels](img/01_raw_labels.webp "XY")', 'examples/cremi/README.md');
  assert.equal(markdown, '![raw and labels](/sparsity/docs/media/examples/cremi/img/01_raw_labels.webp "XY")');
  assert.deepEqual(assets, ['examples/cremi/img/01_raw_labels.webp']);
});

test('a link to a repository file that is not a page goes to GitHub at the given ref', () => {
  const { markdown } = rewrite('[readme](../../README.md#install)', 'examples/cremi/README.md', 'main');
  assert.equal(markdown, '[readme](https://github.com/ucsdmanorlab/bootstrapper/blob/main/README.md#install)');
});

test('external links, anchors and code are left alone', () => {
  const md = [
    '[uv](https://docs.astral.sh/uv/) [here](#install) [mail](mailto:a@b.c)',
    'Inline `[x](cli.md)` stays.',
    '```',
    '[y](cli.md)',
    '```',
  ].join('\n');
  assert.equal(rewrite(md, 'docs/inputs.md').markdown, md);
});

test('a link that leaves the repository is an error', () => {
  assert.throws(() => rewrite('[x](../../../etc/passwd)', 'docs/inputs.md'), /outside the Bootstrapper repository/);
});

function fakeBootstrapper(files) {
  const root = mkdtempSync(join(tmpdir(), 'bs-src-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function fakeSite() {
  const root = mkdtempSync(join(tmpdir(), 'site-ws-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'public'));
  return root;
}

const allPages = Object.fromEntries(PAGES.filter((p) => !p.optional).map((p) => [p.source, `# ${p.title}\n\nText.\n`]));

test('import writes each page with its title, source and preview notice, and copies its images', () => {
  const src = fakeBootstrapper({
    ...allPages,
    'examples/cremi/README.md': '# CREMI tutorial\n\n![seg](img/08.webp)\n',
    'examples/cremi/img/08.webp': 'webp-bytes',
  });
  const site = fakeSite();
  importDocs({ bootstrapperRoot: src, siteRoot: site });
  const page = readFileSync(join(site, 'src/content/docs/cremi.md'), 'utf8');
  assert.match(page, /^---\ntitle: "CREMI tutorial"\nsource: "examples\/cremi\/README.md"\nnotice: "Development preview/);
  assert.match(page, /!\[seg\]\(\/sparsity\/docs\/media\/examples\/cremi\/img\/08.webp\)/);
  assert.equal(readFileSync(join(site, 'public/docs/media/examples/cremi/img/08.webp'), 'utf8'), 'webp-bytes');
  assert.ok(existsSync(join(site, 'src/content/docs/reference/cli.md')));
  assert.ok(!existsSync(join(site, 'src/content/docs/cremi/round2.md')), 'absent optional page is not staged');
});

test('a pinned ref removes the preview notice', () => {
  const site = fakeSite();
  importDocs({ bootstrapperRoot: fakeBootstrapper(allPages), siteRoot: site, ref: 'abc1234' });
  assert.doesNotMatch(readFileSync(join(site, 'src/content/docs/install.md'), 'utf8'), /notice:/);
});

test('import removes pages staged by an earlier run', () => {
  const site = fakeSite();
  importDocs({ bootstrapperRoot: fakeBootstrapper({ ...allPages, 'examples/cremi/round2.md': '# Round 2\n' }), siteRoot: site });
  assert.ok(existsSync(join(site, 'src/content/docs/cremi/round2.md')));
  importDocs({ bootstrapperRoot: fakeBootstrapper(allPages), siteRoot: site });
  assert.ok(!existsSync(join(site, 'src/content/docs/cremi/round2.md')));
});

test('a missing required page stops the import unless placeholders are allowed', () => {
  const files = { ...allPages };
  delete files['docs/install.md'];
  const site = fakeSite();
  assert.throws(() => importDocs({ bootstrapperRoot: fakeBootstrapper(files), siteRoot: site }), /docs\/install.md/);
  importDocs({ bootstrapperRoot: fakeBootstrapper(files), siteRoot: site, allowMissing: true });
  assert.match(readFileSync(join(site, 'src/content/docs/install.md'), 'utf8'), /not written yet/);
});

test('import refuses to write into a git checkout', () => {
  const site = fakeSite();
  mkdirSync(join(site, '.git'));
  assert.throws(() => importDocs({ bootstrapperRoot: fakeBootstrapper(allPages), siteRoot: site }), /git checkout/);
});
