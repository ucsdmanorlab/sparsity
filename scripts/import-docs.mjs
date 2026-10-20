import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = '/sparsity';
const REPO = 'https://github.com/ucsdmanorlab/bootstrapper';
const NOTICE = 'Development preview: these pages come from unreleased Bootstrapper documentation.';

export const PAGES = [
  { source: 'docs/install.md', route: 'install', title: 'Install' },
  { source: 'examples/cremi/README.md', route: 'cremi', title: 'CREMI tutorial' },
  { source: 'examples/cremi/round2.md', route: 'cremi/round2', title: 'CREMI round 2', optional: true },
  { source: 'docs/inputs.md', route: 'your-data', title: 'Your data' },
  { source: 'docs/cli.md', route: 'reference/cli', title: 'Commands' },
  { source: 'docs/config.md', route: 'reference/config', title: 'Configuration' },
  { source: 'docs/python.md', route: 'reference/python', title: 'Python API' },
  { source: 'docs/input-formats.md', route: 'reference/inputs', title: 'Input formats' },
];

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const SCHEME = /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;
const TOKEN = /(^```[\s\S]*?^```)|(`[^`\n]*`)|(!?)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/gm;

function rewriteTarget(target, source, image, pages, ref, assets) {
  if (SCHEME.test(target)) return target;
  const [path, anchor] = target.split(/(?=#)/);
  const resolved = posix.normalize(posix.join(posix.dirname(source), path));
  if (resolved.startsWith('..')) throw new Error(`${source}: ${target} points outside the Bootstrapper repository`);
  if (pages.has(resolved)) return `${BASE}/docs/${pages.get(resolved)}/${anchor ?? ''}`;
  if (image || IMAGE.test(resolved)) {
    assets.push(resolved);
    return `${BASE}/docs/media/${resolved}`;
  }
  return `${REPO}/blob/${ref}/${resolved}${anchor ?? ''}`;
}

export function rewriteMarkdown(markdown, source, { pages, ref = 'main' }) {
  const assets = [];
  const out = markdown.replace(TOKEN, (match, fence, code, bang, text, target, title) => {
    if (fence || code) return match;
    return `${bang}[${text}](${rewriteTarget(target, source, bang === '!', pages, ref, assets)}${title})`;
  });
  return { markdown: out, assets };
}

const firstHeading = (md) => md.match(/^# (.+)$/m)?.[1].replace(/[`*_\\]/g, '').trim();

export function importDocs({ bootstrapperRoot, siteRoot, ref, allowMissing = false }) {
  if (existsSync(join(siteRoot, '.git'))) {
    throw new Error(`${siteRoot} is a git checkout; import into a build workspace copy instead`);
  }
  const present = PAGES.filter((p) => existsSync(join(bootstrapperRoot, p.source)));
  const missing = PAGES.filter((p) => !p.optional && !present.includes(p));
  if (missing.length && !allowMissing) {
    throw new Error(`missing Bootstrapper pages: ${missing.map((p) => p.source).join(', ')}`);
  }
  const staged = [...present, ...missing];
  const pages = new Map(staged.map((p) => [p.source, p.route]));
  const pagesDir = join(siteRoot, 'src/content/docs');
  const mediaDir = join(siteRoot, 'public/docs/media');
  rmSync(pagesDir, { recursive: true, force: true });
  rmSync(mediaDir, { recursive: true, force: true });

  for (const page of staged) {
    const text = present.includes(page)
      ? readFileSync(join(bootstrapperRoot, page.source), 'utf8')
      : `# ${page.title}\n\nThis page is not written yet.\n`;
    const { markdown, assets } = rewriteMarkdown(text, page.source, { pages, ref: ref ?? 'main' });
    const front = [
      `title: ${JSON.stringify(firstHeading(text) ?? page.title)}`,
      `source: ${JSON.stringify(page.source)}`,
      ...(ref ? [] : [`notice: ${JSON.stringify(NOTICE)}`]),
    ];
    const out = join(pagesDir, `${page.route}.md`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `---\n${front.join('\n')}\n---\n\n${markdown}`);
    for (const asset of assets) {
      const to = join(mediaDir, asset);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(bootstrapperRoot, asset), to);
    }
  }
  return { staged: staged.map((p) => p.route), placeholders: missing.map((p) => p.route) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args.splice(i, 2)[1];
  };
  const ref = flag('--ref');
  const allowMissing = args.includes('--allow-missing');
  const [bootstrapperRoot, siteRoot] = args.filter((a) => a !== '--allow-missing');
  if (!bootstrapperRoot || !siteRoot) {
    console.error('usage: node scripts/import-docs.mjs <bootstrapper root> <site workspace> [--ref <commit>] [--allow-missing]');
    process.exit(2);
  }
  const result = importDocs({ bootstrapperRoot: resolve(bootstrapperRoot), siteRoot: resolve(siteRoot), ref, allowMissing });
  console.log(JSON.stringify(result));
}
