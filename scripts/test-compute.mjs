// Synthetic test: no live scores exist pre-tournament, so fabricate matches
// (real team IDs from the draw) and assert each prize path.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compute } from './compute.mjs';

/** @typedef {import('./compute.mjs').RawMatch} RawMatch */
/** @typedef {import('./compute.mjs').TieredDraw} Draw */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const draw = /** @type {Draw} */ (
  JSON.parse(await readFile(join(ROOT, 'data', 'draw_results.json'), 'utf8'))
);

// id lookups by display name (from the draw)
/** @type {Record<string, string>} */
const id = {};
for (const p of draw.people) {
  id[p.group1.name] = p.group1.fifaId;
  id[p.group2.name] = p.group2.fifaId;
}
// Every fixture name below is drawn from the registry above, so the id is always present.
/** @param {string} n @returns {string} */
const tid = (n) => /** @type {string} */ (id[n]);

let mid = 0;
/**
 * @param {string} hName
 * @param {number} h
 * @param {string} aName
 * @param {number} a
 * @returns {RawMatch}
 */
const grp = (hName, h, aName, a) => ({
  IdMatch: `g${++mid}`,
  IdStage: '289273',
  StageName: [{ Description: 'First Stage' }],
  Date: '2026-06-12T19:00:00Z',
  HomeTeamScore: h,
  AwayTeamScore: a,
  Home: { IdTeam: tid(hName), TeamName: [{ Description: hName }], Abbreviation: 'X', Score: h },
  Away: { IdTeam: tid(aName), TeamName: [{ Description: aName }], Abbreviation: 'Y', Score: a },
  Winner: h > a ? tid(hName) : h < a ? tid(aName) : null,
});
/**
 * @param {string} stageId
 * @param {string} stageName
 * @param {string} hName
 * @param {number} h
 * @param {string} aName
 * @param {number} a
 * @param {number} [hp]
 * @param {number} [ap]
 * @returns {RawMatch}
 */
const ko = (stageId, stageName, hName, h, aName, a, hp, ap) => ({
  IdMatch: `k${++mid}`,
  IdStage: stageId,
  StageName: [{ Description: stageName }],
  Date: '2026-07-01T19:00:00Z',
  HomeTeamScore: h,
  AwayTeamScore: a,
  HomeTeamPenaltyScore: hp ?? null,
  AwayTeamPenaltyScore: ap ?? null,
  Home: { IdTeam: tid(hName), TeamName: [{ Description: hName }], Abbreviation: 'X', Score: h },
  Away: { IdTeam: tid(aName), TeamName: [{ Description: aName }], Abbreviation: 'Y', Score: a },
  Winner:
    hp != null
      ? hp > /** @type {number} */ (ap)
        ? tid(hName)
        : tid(aName)
      : h > a
        ? tid(hName)
        : tid(aName),
});

// --- Group stage subset (only a few teams get real results) ---
const matches = [
  // Spain dominant; Curaçao (tier2) decent; clear spoon = Qatar (tier2)
  grp('Spain', 3, 'Qatar', 0),
  grp('Curaçao', 2, 'Qatar', 1),
  grp('Spain', 1, 'Curaçao', 1),
  // Brazil + Australia (tier2) results — Australia scores some goals for prize-3 tiebreak
  grp('Brazil', 2, 'Australia', 2),
  grp('Australia', 3, 'Ghana', 1),
];

// --- Knockouts: Curaçao (tier2) goes deep; champion path via Spain ---
matches.push(
  ko('289287', 'Round of 32', 'Curaçao', 1, 'Brazil', 0), // Curaçao reaches R16 (depth 2)
  ko('289288', 'Round of 16', 'Curaçao', 0, 'Spain', 2), // Curaçao eliminated R16
  ko('289290', 'Semi-final', 'Spain', 1, 'France', 0),
  ko('289291', 'Play-off for third place', 'France', 2, 'Argentina', 1), // 3rd = France
  ko('289292', 'Final', 'Spain', 1, 'Portugal', 0), // champion = Spain
);

const r = compute(draw, matches, '2026-07-19T22:00:00Z');
// All asserted teams exist in the fixtures above; cast away the find()'s undefined.
/** @param {string} n @returns {import('../src/types').TeamRef} */
const byName = (n) =>
  /** @type {import('../src/types').TeamRef} */ (r.teams.find((t) => t.name === n));

// Prize 1: champion = Spain
assert.equal(r.prizes.first.status, 'decided');
assert.equal(r.prizes.first.winner?.name, 'Spain');
assert.equal(byName('Spain').champion, true);

// Prize 2: 3rd place = France (won the playoff)
assert.equal(r.prizes.second.winner?.name, 'France');

// Prize 3: best tier-2 = Curaçao (reached R16 = depth 2, deepest of any tier2)
assert.equal(r.prizes.third.leaders.length, 1);
assert.equal(r.prizes.third.leaders[0]?.name, 'Curaçao');
assert.equal(r.prizes.third.leaders[0].furthestLabel, 'Round of 16');

// Prize 4: wooden shrew = Qatar (0 pts, -4 GD across its 2 group games)
assert.equal(r.prizes.fourth.leaders[0]?.name, 'Qatar');
assert.equal(byName('Qatar').pts, 0);
assert.equal(byName('Qatar').gd, -4);

// Group table sanity: Spain 4 pts (W + D), Curaçao 4 pts, Qatar 0
assert.equal(byName('Spain').pts, 4);
assert.equal(byName('Curaçao').pts, 4);

// Goals: only group goals count to gf; Curaçao knockout goals excluded from group gf
assert.equal(byName('Curaçao').gf, 3); // 2 vs Qatar + 1 vs Spain
assert.equal(byName('Curaçao').ogf, 4); // + 1 in R32 (R16 was 0)

// Elimination: Curaçao out (lost R16); Qatar out (group, not in knockouts); Spain champion not out
assert.equal(byName('Curaçao').eliminated, true);
assert.equal(byName('Qatar').eliminated, true);
assert.equal(byName('Spain').eliminated, false);

// Teams with no fixtures stay neutral (not eliminated, depth 0)
assert.equal(byName('Iraq').eliminated, false);
assert.equal(byName('Iraq').furthestDepth, 0);

// Prize status: champion won winner; France (3rd-place winner) won third, lost winner
assert.equal(byName('Spain').status.winner, 'won');
assert.equal(byName('France').status.third, 'won');
assert.equal(byName('France').status.winner, 'lost');
assert.equal(byName('Portugal').status.third, 'lost'); // runner-up: reached final, can't be 3rd
// Best group-2 decided to Curaçao at tournament end
assert.equal(byName('Curaçao').status.bestGroup2, 'won');
assert.equal(byName('Spain').status.bestGroup2, 'na'); // tier-1 ineligible
// Shrew decided (groups complete in this sim) — Qatar won it, others lost (safe)
assert.equal(byName('Qatar').status.shrew, 'won');
assert.equal(byName('Spain').status.shrew, 'lost');
// Person rollup: Josh owns Spain (champion) + Curaçao (best group-2)
const josh = r.people.find((p) => p.name === 'Josh');
assert.equal(josh?.status.winner, 'won');
assert.equal(josh.status.bestGroup2, 'won');
// teams[] carries both owned sides in [group1, group2] order
assert.deepEqual(
  josh.teams.map((t) => t.name),
  ['Spain', 'Curaçao'],
);
// Bracket + league table present
assert.ok(r.knockout.length >= 1 && r.leagueTable.length === 48);

console.log('All assertions passed.');
console.log('  champion:', r.prizes.first.winner.name);
console.log('  3rd place:', r.prizes.second.winner.name);
console.log(
  '  best tier-2:',
  r.prizes.third.leaders.map((t) => `${t.name} (${t.furthestLabel})`).join(', '),
);
console.log(
  '  wooden shrew:',
  r.prizes.fourth.leaders.map((t) => `${t.name} ${t.pts}pts ${t.gd}gd`).join(', '),
);
