// Copy a simulated snapshot over data/results.json so the dashboard renders it.
// Usage: node scripts/use-snapshot.mjs <name>   (e.g. 02-group-complete)
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'snapshots');
const name = process.argv[2];

const available = (await readdir(DIR)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
if (!name || !available.includes(name)) {
  console.error(`Usage: node scripts/use-snapshot.mjs <name>\nAvailable: ${available.join(', ')}`);
  process.exit(1);
}

const snap = await readFile(join(DIR, `${name}.json`), 'utf8');
await writeFile(join(ROOT, 'data', 'results.json'), snap);
console.log(`results.json now shows snapshot "${name}".`);
