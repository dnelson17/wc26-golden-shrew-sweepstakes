// Synthetic test for the full-group ownership mode (the Nelson league):
// each player owns a whole FIFA group, teams aren't tiered, and there's no
// best-group-2 prize. Fabricates a tiny 2-group tournament and asserts the paths.
import assert from 'node:assert/strict';
import { compute } from './compute.mjs';

/** @typedef {import('./compute.mjs').RawMatch} RawMatch */
/** @typedef {import('./compute.mjs').FullGroupDraw} FullGroupDraw */

/** @param {string} id @param {string} name @param {string} iso2 */
const team = (id, name, iso2) => ({
  name,
  fifaName: name,
  fifaId: id,
  idCountry: name.slice(0, 3).toUpperCase(),
  iso2,
});

const draw = /** @type {FullGroupDraw} */ ({
  ownershipMode: 'full-group',
  groupOwners: { A: 'Alice', B: 'Bob' },
  teams: [
    team('1', 'Spain', 'es'),
    team('2', 'Qatar', 'qa'),
    team('3', 'Brazil', 'br'),
    team('4', 'Ghana', 'gh'),
  ],
  meta: { idCompetition: '17', idSeason: '285023' },
});

let mid = 0;
/**
 * @param {string} group @param {string} hId @param {string} hName @param {number} h
 * @param {string} aId @param {string} aName @param {number} a @returns {RawMatch}
 */
const grp = (group, hId, hName, h, aId, aName, a) => ({
  IdMatch: `g${++mid}`,
  IdStage: '289273',
  StageName: [{ Description: 'First Stage' }],
  GroupName: [{ Description: `Group ${group}` }],
  Date: '2026-06-12T19:00:00Z',
  HomeTeamScore: h,
  AwayTeamScore: a,
  Home: { IdTeam: hId, TeamName: [{ Description: hName }], Score: h },
  Away: { IdTeam: aId, TeamName: [{ Description: aName }], Score: a },
  Winner: h > a ? hId : h < a ? aId : null,
});

const matches = [
  grp('A', '1', 'Spain', 3, '2', 'Qatar', 0),
  grp('B', '3', 'Brazil', 2, '4', 'Ghana', 1),
  // Final: Spain beat Brazil
  {
    IdMatch: 'f1',
    IdStage: '289292',
    StageName: [{ Description: 'Final' }],
    Date: '2026-07-19T19:00:00Z',
    HomeTeamScore: 2,
    AwayTeamScore: 0,
    Home: { IdTeam: '1', TeamName: [{ Description: 'Spain' }], Score: 2 },
    Away: { IdTeam: '3', TeamName: [{ Description: 'Brazil' }], Score: 0 },
    Winner: '1',
  },
];

const r = compute(draw, matches, '2026-07-19T22:00:00Z');
/** @param {string} n */
const byName = (n) =>
  /** @type {import('../src/types').TeamRef} */ (r.teams.find((t) => t.name === n));

// Ownership resolves from each team's live group letter
assert.equal(byName('Spain').owner, 'Alice');
assert.equal(byName('Qatar').owner, 'Alice');
assert.equal(byName('Brazil').owner, 'Bob');
assert.equal(byName('Ghana').owner, 'Bob');
assert.equal(byName('Spain').group, 'A');

// Teams aren't tiered
assert.equal(byName('Spain').tier, null);

// Each player owns their whole group
assert.equal(r.people.length, 2);
const alice = /** @type {import('../src/types').Person} */ (
  r.people.find((p) => p.name === 'Alice')
);
assert.deepEqual(alice.teams.map((t) => t.name).sort(), ['Qatar', 'Spain']);

// No best-group-2 prize in this mode
assert.equal(byName('Spain').status.bestGroup2, 'na');
assert.equal(alice.status.bestGroup2, 'na');
assert.equal(r.prizes.third.leaders.length, 0);

// Champion + rollup
const champ = /** @type {import('../src/types').TeamRef} */ (r.prizes.first.winner);
assert.equal(champ.name, 'Spain');
assert.equal(alice.status.winner, 'won');

// Wooden shrew = worst overall: Qatar (0 pts, -3 GD) below Ghana (0 pts, -1 GD)
assert.equal(r.prizes.fourth.leaders[0]?.name, 'Qatar');
assert.equal(byName('Qatar').status.shrew, 'won');

console.log('Nelson full-group assertions passed.');
console.log('  champion:', champ.name);
console.log('  Alice owns:', alice.teams.map((t) => t.name).join(', '));
console.log('  wooden shrew:', r.prizes.fourth.leaders.map((t) => t.name).join(', '));
