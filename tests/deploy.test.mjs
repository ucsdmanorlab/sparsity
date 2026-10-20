import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES } from '../scripts/import-docs.mjs';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = '0123456789abcdef0123456789abcdef01234567';

const run = (script, ...args) => spawnSync(process.execPath, [join(site, 'scripts', script), ...args], { encoding: 'utf8' });
const runIn = (env, script, ...args) => spawnSync(process.execPath, [join(site, 'scripts', script), ...args], { encoding: 'utf8', env });

function refFile(text) {
  const path = join(mkdtempSync(join(tmpdir(), 'ref-')), 'bootstrapper-ref.txt');
  writeFileSync(path, text);
  return path;
}

function gitStub(head) {
  const root = mkdtempSync(join(tmpdir(), 'bs-git-stub-'));
  const checkout = join(root, 'checkout');
  const bin = join(root, 'bin');
  const log = join(root, 'calls.log');
  mkdirSync(checkout);
  mkdirSync(bin);
  const sq = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
  writeFileSync(join(bin, 'git'), [
    '#!/bin/sh',
    `printf '[%s]' "$@" >> ${sq(log)}; echo >> ${sq(log)}`,
    `if [ "$#" -eq 4 ] && [ "$1" = -C ] && [ "$2" = ${sq(checkout)} ] && [ "$3" = rev-parse ] && [ "$4" = HEAD ]; then`,
    `  echo ${head}; exit 0`,
    'fi',
    'echo "git stub: unexpected arguments: $*" >&2; exit 97',
    '',
  ].join('\n'), { mode: 0o755 });
  const env = { PATH: bin };
  return { checkout, env, bin: join(bin, 'git'), calls: () => readFileSync(log, 'utf8') };
}

test('a ref file with one 40-hex commit prints that commit', () => {
  for (const text of [SHA, `${SHA}\n`]) {
    const r = run('pinned-ref.mjs', refFile(text));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${SHA}\n`);
  }
});

test('a missing ref file fails and prints no commit', () => {
  const r = run('pinned-ref.mjs', join(mkdtempSync(join(tmpdir(), 'ref-')), 'bootstrapper-ref.txt'));
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /bootstrapper-ref\.txt/);
});

test('a ref file without exactly one lowercase 40-hex commit fails', () => {
  const bad = ['', '\n', 'main', 'v1.0.0', SHA.slice(0, 7), `${SHA}0`, SHA.toUpperCase(), ` ${SHA}`, `${SHA} `,
    `${SHA}\n\n`, `${SHA}\n${SHA}\n`, `${SHA.slice(0, 39)}g`];
  for (const text of bad) {
    const r = run('pinned-ref.mjs', refFile(text));
    assert.equal(r.status, 1, JSON.stringify(text));
    assert.equal(r.stdout, '', JSON.stringify(text));
    assert.match(r.stderr, /bootstrapper-ref\.txt must hold one 40-hex commit/, JSON.stringify(text));
  }
});

test('a checkout whose HEAD is the pinned commit passes', () => {
  const git = gitStub(SHA);
  const r = runIn(git.env, 'pinned-ref.mjs', refFile(`${SHA}\n`), git.checkout);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${SHA}\n`);
  assert.equal(git.calls(), `[-C][${git.checkout}][rev-parse][HEAD]\n`);
  for (const args of [['rev-parse', 'HEAD'], ['-C', git.checkout, 'commit', '-m', 'x'], ['-C', git.checkout, 'rev-parse', 'HEAD', 'x']]) {
    assert.equal(spawnSync(git.bin, args, { env: git.env }).status, 97, args.join(' '));
  }
});

test('a checkout whose HEAD is another commit fails', () => {
  const head = 'fedcba9876543210fedcba9876543210fedcba98';
  const git = gitStub(head);
  const r = runIn(git.env, 'pinned-ref.mjs', refFile(`${SHA}\n`), git.checkout);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, new RegExp(head));
  assert.equal(git.calls(), `[-C][${git.checkout}][rev-parse][HEAD]\n`);
});

test('a pinned import links repository files at the commit and has no preview notice', () => {
  const src = mkdtempSync(join(tmpdir(), 'bs-src-'));
  for (const p of PAGES.filter((p) => !p.optional)) {
    mkdirSync(dirname(join(src, p.source)), { recursive: true });
    writeFileSync(join(src, p.source), `# ${p.title}\n\nSee [the license](../LICENSE).\n`);
  }
  const ws = mkdtempSync(join(tmpdir(), 'site-ws-'));
  const r = run('import-docs.mjs', src, ws, '--ref', SHA);
  assert.equal(r.status, 0, r.stderr);
  const page = readFileSync(join(ws, 'src/content/docs/install.md'), 'utf8');
  assert.doesNotMatch(page, /notice:/);
  assert.match(page, new RegExp(`\\(https://github\\.com/ucsdmanorlab/bootstrapper/blob/${SHA}/LICENSE\\)`));
  assert.doesNotMatch(page, /blob\/main\//);
});

test('the deploy workflow builds the docs only from the pinned Bootstrapper commit', () => {
  const wf = readFileSync(join(site, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(wf, /node-version: 22\n/);
  const order = [
    'node scripts/pinned-ref.mjs bootstrapper-ref.txt',
    'repository: ucsdmanorlab/bootstrapper',
    'ref: ${{ steps.ref.outputs.sha }}',
    'node site/scripts/pinned-ref.mjs site/bootstrapper-ref.txt bootstrapper',
    'npm ci',
    'npm test',
    'node scripts/import-docs.mjs "$GITHUB_WORKSPACE/bootstrapper" . --ref "$REF"',
    'npx astro build',
    'node scripts/check-dist.mjs dist',
    'path: ${{ runner.temp }}/site/dist',
  ];
  let at = -1;
  for (const line of order) {
    const i = wf.indexOf(line, at + 1);
    assert.ok(i > at, `missing or out of order: ${line}`);
    at = i;
  }
  assert.doesNotMatch(wf, /--allow-missing|ref: main|path: \.\/dist/);
});

test('the workflow read step stops on a missing or invalid pin and outputs only a valid pin', () => {
  const wf = readFileSync(join(site, '.github/workflows/deploy.yml'), 'utf8');
  const step = wf.match(/\n( +)- name: Read pinned Bootstrapper commit\n([\s\S]*?)(?=\n\1- |$)/)?.[2];
  assert.ok(step, 'missing read step');
  const block = step.match(/^( +)run: \|\n((?:\1 +\S.*\n?|\n)+)/m)?.[2];
  assert.ok(block, 'missing read step shell block');
  const indent = block.match(/^ */)[0];
  const script = block.split('\n').map((l) => l.slice(indent.length)).join('\n');
  const root = mkdtempSync(join(tmpdir(), 'deploy-shell-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(join(site, 'scripts/pinned-ref.mjs'), join(root, 'scripts/pinned-ref.mjs'));
  writeFileSync(join(root, 'step.sh'), script);
  const output = join(root, 'github-output');
  const cases = [undefined, '', 'main\n', `${SHA.slice(0, 7)}\n`, `${SHA.toUpperCase()}\n`, `${SHA}\n\n`, `${SHA}\nsha=main\n`, `${SHA}\n`];
  for (const text of cases) {
    rmSync(join(root, 'bootstrapper-ref.txt'), { force: true });
    if (text !== undefined) writeFileSync(join(root, 'bootstrapper-ref.txt'), text);
    writeFileSync(output, '');
    // GitHub runs a Linux run block with no shell key as `bash -e {0}`.
    const r = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', join(root, 'step.sh')], {
      cwd: root,
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, GITHUB_OUTPUT: output },
      encoding: 'utf8',
      timeout: 10000,
    });
    const valid = text === `${SHA}\n`;
    assert.equal(r.status, valid ? 0 : 1, `${JSON.stringify(text)}: ${r.stderr}`);
    assert.equal(readFileSync(output, 'utf8'), valid ? `sha=${SHA}\n` : '', JSON.stringify(text));
  }
});
