import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [file, checkout] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/pinned-ref.mjs <ref file> [<bootstrapper checkout>]');
  process.exit(2);
}
let text;
try {
  text = readFileSync(file, 'utf8');
} catch (e) {
  console.error(`${file}: ${e.message}`);
  process.exit(1);
}
const sha = text.match(/^([0-9a-f]{40})\n?$/)?.[1];
if (!sha) {
  console.error(`${file}: bootstrapper-ref.txt must hold one 40-hex commit`);
  process.exit(1);
}
if (checkout) {
  const head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== sha) {
    console.error(`${checkout}: HEAD ${head} is not the pinned commit ${sha}`);
    process.exit(1);
  }
}
console.log(sha);
