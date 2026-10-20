import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE = 'https://ucsdmanorlab.github.io';
const BASE = '/sparsity/';
const LOCAL = 'http://local';

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'data' ? [] : htmlFiles(path);
    return e.name.endsWith('.html') ? [path] : [];
  });
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => decode(m[1])));

export function checkDist(dist) {
  const problems = [];
  const pages = new Map();
  for (const file of htmlFiles(dist)) {
    const rel = relative(dist, file);
    pages.set(rel, readFileSync(file, 'utf8'));
  }
  const fileFor = (path) => {
    const rel = decodeURIComponent(path.slice(BASE.length));
    const full = join(dist, rel);
    if (rel === '' || rel.endsWith('/')) return join(rel, 'index.html');
    if (existsSync(full) && statSync(full).isDirectory()) return join(rel, 'index.html');
    return existsSync(full) ? rel : null;
  };

  for (const [rel, html] of pages) {
    const route = rel.replace(/(^|\/)index\.html$/, '$1');
    const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
    if (h1 !== 1) problems.push(`${rel}: ${h1} h1 elements`);
    const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
    const expected = `${SITE}${BASE}${route}`;
    if (canonical !== expected) problems.push(`${rel}: canonical ${canonical} is not ${expected}`);

    for (const [dash] of html.matchAll(/[\u2013\u2014][a-z][\w-]*/g)) {
      problems.push(`${rel}: dash before a flag name: ${dash}`);
    }

    const pageUrl = new URL(`${BASE}${route}`, LOCAL);
    for (const [, attr, raw] of html.matchAll(/\s(href|src|poster)="([^"]*)"/g)) {
      const value = decode(raw);
      const url = new URL(value, pageUrl);
      if (url.origin !== LOCAL) continue;
      if (!url.pathname.startsWith(BASE) && url.pathname !== BASE.slice(0, -1)) {
        problems.push(`${rel}: link outside /sparsity: ${value}`);
        continue;
      }
      const target = fileFor(url.pathname.endsWith('/') || url.pathname.includes('.') ? url.pathname : `${url.pathname}/`);
      if (!target || (target.endsWith('index.html') && !pages.has(target))) {
        problems.push(`${rel}: missing target ${value}`);
        continue;
      }
      const anchor = url.hash.slice(1);
      if (anchor && !ids(pages.get(target) ?? '').has(decodeURIComponent(anchor))) {
        problems.push(`${rel}: missing anchor ${value}`);
      }
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dist = process.argv[2];
  if (!dist) {
    console.error('usage: node scripts/check-dist.mjs <dist dir>');
    process.exit(2);
  }
  const problems = checkDist(dist);
  for (const p of problems) console.log(p);
  console.log(`${problems.length} problems in ${htmlFiles(dist).length} pages`);
  process.exit(problems.length ? 1 : 0);
}
