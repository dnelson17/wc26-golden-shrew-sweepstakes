// Fetch 2026 World Cup matches from FIFA, compute prize standings, write results.json.
// Run: node scripts/fetch.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compute } from './compute.mjs';

/** @typedef {import('./compute.mjs').RawMatch} RawMatch */
/** @typedef {import('./compute.mjs').Draw} Draw */

/**
 * The relevant slice of a FIFA `/calendar/matches` response.
 * @typedef {{ Results?: RawMatch[] }} FifaResponse
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRAW_PATH = join(ROOT, 'data', 'draw_results.json');
const OUT_PATH = join(ROOT, 'data', 'results.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://api.fifa.com/api/v3/calendar/matches';

/**
 * @param {Record<string, string | undefined>} params
 * @returns {Promise<FifaResponse>}
 */
async function fifa(params) {
  const url = `${BASE}?${new URLSearchParams(/** @type {Record<string, string>} */ (params))}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`FIFA ${res.status} for ${url}`);
  return /** @type {Promise<FifaResponse>} */ (res.json());
}

// Re-discover idSeason if the pinned one ever breaks.
async function discoverSeason() {
  const data = await fifa({ from: '2026-06-11T00:00:00Z', count: '500', language: 'en' });
  const wc = (data.Results ?? []).find((m) =>
    (m.CompetitionName?.[0]?.Description || '').startsWith('FIFA World Cup'),
  );
  if (!wc) throw new Error('Could not re-discover 2026 World Cup season');
  return { idCompetition: wc.IdCompetition, idSeason: wc.IdSeason };
}

// Tournament window (UTC). Outside it, scores never change — skip the call.
// Override with FORCE=1 (e.g. manual workflow_dispatch).
const WINDOW_START = Date.parse('2026-06-11T00:00:00Z');
const WINDOW_END = Date.parse('2026-07-20T23:59:59Z');

async function main() {
  const now = Date.now();
  if (!process.env['FORCE'] && (now < WINDOW_START || now > WINDOW_END)) {
    console.log(
      'Outside tournament window (11 Jun – 20 Jul 2026 UTC); skipping. Set FORCE=1 to override.',
    );
    return;
  }
  const draw = /** @type {Draw} */ (JSON.parse(await readFile(DRAW_PATH, 'utf8')));
  let { idCompetition, idSeason } = draw.meta ?? {};

  let data = await fifa({ idCompetition, idSeason, count: '500', language: 'en' });
  if (!data.Results || data.Results.length < 100) {
    console.warn(`Pinned season returned ${data.Results?.length ?? 0} matches; re-discovering...`);
    ({ idCompetition, idSeason } = await discoverSeason());
    data = await fifa({ idCompetition, idSeason, count: '500', language: 'en' });
  }

  const nowIso = new Date().toISOString();
  const results = compute(draw, /** @type {RawMatch[]} */ (data.Results), nowIso);
  console.log(
    `Computed: ${results.meta.playedMatches}/${results.meta.totalMatches} played, ` +
      `groupComplete=${results.meta.groupComplete}, over=${results.meta.tournamentOver}`,
  );

  // Stable output (drop the timestamp) so unchanged data produces an identical
  // file — lets the workflow skip empty commits.
  /** @param {import('../src/types').Results} obj */
  const stable = (obj) => JSON.stringify({ ...obj, meta: { ...obj.meta, updatedAt: null } });
  let prevStable = null;
  try {
    prevStable = stable(
      /** @type {import('../src/types').Results} */ (JSON.parse(await readFile(OUT_PATH, 'utf8'))),
    );
  } catch {
    // No previous results.json yet — treat the new output as changed.
  }
  if (stable(results) === prevStable) {
    console.log('No change since last run — leaving results.json untouched.');
    return;
  }

  await writeFile(OUT_PATH, JSON.stringify(results, null, 2) + '\n');
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((/** @type {unknown} */ e) => {
  console.error(e);
  process.exit(1);
});
