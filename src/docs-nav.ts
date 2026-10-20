export interface DocsLink {
  path: string;
  label: string;
  summary: string;
}

export interface Heading {
  depth: number;
  slug: string;
  text: string;
}

export function pageContents(headings: Heading[]): (Heading & { children: Heading[] })[] {
  const groups: (Heading & { children: Heading[] })[] = [];
  for (const heading of headings) {
    if (heading.depth === 2) groups.push({ ...heading, children: [] });
    else if (heading.depth === 3) groups.at(-1)?.children.push(heading);
  }
  return groups;
}

export const REFERENCE: DocsLink[] = [
  { path: 'docs/reference/cli/', label: 'Commands', summary: 'Every bs command and its options.' },
  { path: 'docs/reference/config/', label: 'Configuration', summary: 'Every key a config table accepts.' },
  { path: 'docs/reference/inputs/', label: 'Input formats', summary: 'Array, metadata and voxel-grid requirements.' },
  { path: 'docs/reference/python/', label: 'Python API', summary: 'Modules, functions and classes of the package.' },
];

export const DOCS: DocsLink[] = [
  { path: 'docs/install/', label: 'Get started', summary: 'Install Bootstrapper and check that bs runs.' },
  { path: 'docs/cremi/', label: 'CREMI', summary: 'Segment a public EM volume from sparse labels.' },
  { path: 'docs/your-data/', label: 'Your data', summary: 'Point Bootstrapper at your own image and labels.' },
  { path: 'docs/reference/', label: 'Reference', summary: 'Commands, configuration, input formats and Python API.' },
];

const OVERVIEW: DocsLink = { path: 'docs/', label: 'Overview', summary: '' };
const ROUND2: DocsLink = { path: 'docs/cremi/round2/', label: 'CREMI round 2', summary: '' };
const ROUND2_PARENT = 'docs/cremi/';

const [install, cremi, yourData, reference] = DOCS;
export const SEQUENCE: DocsLink[] = [OVERVIEW, install, cremi, ROUND2, yourData, reference, ...REFERENCE];

export function pager(path: string, hasRound2: boolean): { prev?: DocsLink; next?: DocsLink } {
  const pages = hasRound2 ? SEQUENCE : SEQUENCE.filter((p) => p !== ROUND2);
  const i = pages.findIndex((p) => p.path === path);
  if (i < 0) return {};
  return { prev: pages[i - 1], next: pages[i + 1] };
}

export function currentMark(here: string, path: string): 'page' | 'location' | undefined {
  if (here === path) return 'page';
  if (here === ROUND2.path && path === ROUND2_PARENT) return 'location';
  return undefined;
}
