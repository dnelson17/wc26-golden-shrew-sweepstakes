// Deterministic tournament simulator. Uses betting odds to decide every result,
// overlays them on the REAL FIFA fixture skeleton (real dates/stages), then emits
// staged snapshots so we can preview the dashboard at different points.
//
// Rules (per spec):
//  - Group game: draw if draw_odds <= 3.5, else the shorter-priced team wins.
//  - Knockout game: shorter outright-winner price advances (no draws; pens if prices ~level).
//  - Scorelines: deterministic function of the odds (see scoreFor / koScore).
//
// Run: node scripts/simulate.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compute, STAGE_DEPTH } from './compute.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...x) => join(ROOT, ...x);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ALIAS = { Curacao: 'Curaçao', 'Czech Republic': 'Czechia', Turkey: 'Türkiye' };
const norm = (n) => ALIAS[n] ?? n;

const STAGE = {
  group: { id: '289273', name: 'First Stage', depth: 0 },
  r32: { id: '289287', name: 'Round of 32', depth: 1 },
  r16: { id: '289288', name: 'Round of 16', depth: 2 },
  qf: { id: '289289', name: 'Quarter-final', depth: 3 },
  sf: { id: '289290', name: 'Semi-final', depth: 4 },
  third: { id: '289291', name: 'Play-off for third place', depth: 5 },
  final: { id: '289292', name: 'Final', depth: 6 },
};
const DEPTH_STAGE = Object.fromEntries(Object.values(STAGE).map((s) => [s.depth, s]));

// --- deterministic scorelines from odds ---
function marginScore(ratio) {
  // ratio = longer price / shorter price (>=1). Bigger gap => bigger win.
  if (ratio < 1.5) return [1, 0];
  if (ratio < 2.2) return [2, 1];
  if (ratio < 3.5) return [2, 0];
  if (ratio < 6) return [3, 1];
  if (ratio < 10) return [3, 0];
  return [4, 0];
}
function drawScore(homeOdds, awayOdds) {
  const sum = homeOdds + awayOdds;
  if (sum < 4) return [2, 2];
  if (sum < 7) return [1, 1];
  return [0, 0];
}

async function fifa() {
  const url = 'https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=285023&count=500&language=en';
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`FIFA ${res.status}`);
  return (await res.json()).Results;
}

function buildMatch(stage, date, idMatch, home, away) {
  // home/away: { team, score } or null (unresolved). team = registry entry.
  const side = (s) => s && s.team ? {
    IdTeam: s.team.fifaId, Abbreviation: s.team.iso2,
    TeamName: [{ Description: s.team.name }], Score: s.score ?? null,
  } : null;
  let winner = null;
  if (home?.team && away?.team && home.score != null) {
    if (home.pen != null) winner = home.pen > away.pen ? home.team.fifaId : away.team.fifaId;
    else if (home.score > away.score) winner = home.team.fifaId;
    else if (home.score < away.score) winner = away.team.fifaId;
  }
  return {
    IdMatch: idMatch, IdStage: stage.id, StageName: [{ Description: stage.name }],
    Date: date, HomeTeamScore: home?.score ?? null, AwayTeamScore: away?.score ?? null,
    HomeTeamPenaltyScore: home?.pen ?? null, AwayTeamPenaltyScore: away?.pen ?? null,
    Home: side(home), Away: side(away),
    PlaceHolderA: home?.team ? null : (home?.ph ?? 'TBD'),
    PlaceHolderB: away?.team ? null : (away?.ph ?? 'TBD'),
    Winner: winner,
  };
}

function seedBracketOrder(n) {
  let order = [1, 2];
  while (order.length < n) {
    const m = order.length * 2 + 1;
    const next = [];
    for (const s of order) { next.push(s); next.push(m - s); }
    order = next;
  }
  return order;
}

async function main() {
  const draw = JSON.parse(await readFile(p('data/draw_results.json'), 'utf8'));
  const groupOdds = JSON.parse(await readFile(p('data/odds/group_stage_odds.json'), 'utf8'));
  const outright = JSON.parse(await readFile(p('data/odds/outright_odds.json'), 'utf8'));

  // registry by fifaId + name lookup
  const reg = new Map();
  const byName = new Map();
  for (const person of draw.people) for (const tier of [1, 2]) {
    const t = { ...person[tier === 1 ? 'group1' : 'group2'] };
    reg.set(t.fifaId, t); byName.set(t.name, t); byName.set(t.fifaName, t);
  }
  const outDec = new Map();
  for (const o of outright) { const t = byName.get(norm(o.team)); if (t) outDec.set(t.fifaId, o.decimal); }
  const decOf = (t) => outDec.get(t.fifaId) ?? 9999;

  // odds lookup by unordered team pair
  const pairKey = (a, b) => [a, b].sort().join('|');
  const oddsByPair = new Map();
  for (const g of groupOdds) {
    const h = byName.get(norm(g.home_team)); const a = byName.get(norm(g.away_team));
    if (h && a) oddsByPair.set(pairKey(h.fifaId, a.fifaId), { ...g, h, a });
  }

  const skeleton = await fifa();
  const txt = (x) => x?.[0]?.Description ?? null;
  const realByStage = {};
  for (const m of skeleton) {
    const depth = STAGE_DEPTH[txt(m.StageName)] ?? 0;
    (realByStage[depth] ??= []).push(m);
  }
  for (const d of Object.keys(realByStage)) realByStage[d].sort((x, y) => (x.Date ?? '').localeCompare(y.Date ?? ''));

  // --- 1. Group stage: overlay scores onto real group fixtures ---
  const out = [];
  const groupStats = new Map(); // fifaId -> {team, pts,gd,gf,ga, group}
  const init = (t) => groupStats.get(t.fifaId) ?? (groupStats.set(t.fifaId, { team: t, pts: 0, gf: 0, ga: 0 }), groupStats.get(t.fifaId));
  // reconstruct groups: teams sharing a real group fixture are in the same group
  const adj = new Map();
  for (const m of realByStage[0]) {
    const h = m.Home?.IdTeam, a = m.Away?.IdTeam; if (!h || !a) continue;
    (adj.get(h) ?? adj.set(h, new Set()).get(h)).add(a);
    (adj.get(a) ?? adj.set(a, new Set()).get(a)).add(h);
  }
  const groupOf = new Map(); let gi = 0;
  for (const start of adj.keys()) {
    if (groupOf.has(start)) continue;
    const stack = [start]; while (stack.length) { const n = stack.pop(); if (groupOf.has(n)) continue; groupOf.set(n, gi); for (const nb of adj.get(n)) if (!groupOf.has(nb)) stack.push(nb); }
    gi++;
  }

  for (const m of realByStage[0]) {
    const h = reg.get(m.Home?.IdTeam), a = reg.get(m.Away?.IdTeam);
    const o = oddsByPair.get(pairKey(h.fifaId, a.fifaId));
    let hs, as_;
    if (o.draw_odds <= 3.5) { [hs, as_] = drawScore(o.home_odds, o.away_odds); }
    else {
      const homeFav = o.home_odds <= o.away_odds;
      const ratio = homeFav ? o.away_odds / o.home_odds : o.home_odds / o.away_odds;
      const [w, l] = marginScore(ratio);
      [hs, as_] = homeFav ? [w, l] : [l, w];
    }
    out.push(buildMatch(STAGE.group, m.Date, m.IdMatch, { team: h, score: hs }, { team: a, score: as_ }));
    const sh = init(h), sa = init(a); sh.group = groupOf.get(h.fifaId); sa.group = groupOf.get(a.fifaId);
    sh.gf += hs; sh.ga += as_; sa.gf += as_; sa.ga += hs;
    if (hs > as_) sh.pts += 3; else if (hs < as_) sa.pts += 3; else { sh.pts++; sa.pts++; }
  }
  for (const s of groupStats.values()) s.gd = s.gf - s.ga;

  // --- 2. Standings -> qualifiers (top 2 + 8 best thirds) ---
  const cmp = (x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || decOf(x.team) - decOf(y.team) || x.team.fifaId.localeCompare(y.team.fifaId);
  const groups = [...new Set([...groupStats.values()].map((s) => s.group))]
    .map((g) => [...groupStats.values()].filter((s) => s.group === g).sort(cmp));
  const winners = groups.map((g) => g[0]);
  const runners = groups.map((g) => g[1]);
  const thirds = groups.map((g) => g[2]).sort(cmp).slice(0, 8);
  const qualifiers = [...winners, ...runners, ...thirds].sort(cmp); // strongest first = seed 1

  // --- 3. Single-elim bracket of 32, seeded by group performance then odds ---
  const order = seedBracketOrder(32); // bracket positions of seeds 1..32
  let bracket = order.map((seed) => qualifiers[seed - 1].team);
  const koWinner = (A, B) => (decOf(A) < decOf(B) ? A : decOf(B) < decOf(A) ? B
    : qualifiers.findIndex((q) => q.team === A) <= qualifiers.findIndex((q) => q.team === B) ? A : B);
  const playKO = (A, B) => {
    const win = koWinner(A, B); const lose = win === A ? B : A;
    const ratio = decOf(lose) / decOf(win);
    if (ratio < 1.2) { // ~level: draw then pens, favourite through
      const score = win === A ? { hs: 1, as: 1, hp: 4, ap: 2 } : { hs: 1, as: 1, hp: 2, ap: 4 };
      return { win, lose, ...score };
    }
    const [w, l] = marginScore(ratio);
    return win === A ? { win, lose, hs: w, as: l, hp: null, ap: null } : { win, lose, hs: l, as: w, hp: null, ap: null };
  };

  const stageSeq = [['r32', 1], ['r16', 2], ['qf', 3], ['sf', 4]];
  const sfLosers = [];
  for (const [key, depth] of stageSeq) {
    const slots = realByStage[depth];
    const winnersNext = [];
    for (let i = 0; i < bracket.length; i += 2) {
      const A = bracket[i], B = bracket[i + 1];
      const r = playKO(A, B);
      const slot = slots[i / 2];
      out.push(buildMatch(STAGE[key], slot.Date, slot.IdMatch,
        { team: A, score: r.hs, pen: r.hp }, { team: B, score: r.as, pen: r.ap }));
      winnersNext.push(r.win);
      if (key === 'sf') sfLosers.push(r.lose);
    }
    bracket = winnersNext;
  }
  // 3rd-place playoff + final
  const tp = playKO(sfLosers[0], sfLosers[1]);
  out.push(buildMatch(STAGE.third, realByStage[5][0].Date, realByStage[5][0].IdMatch,
    { team: sfLosers[0], score: tp.hs, pen: tp.hp }, { team: sfLosers[1], score: tp.as, pen: tp.ap }));
  const fin = playKO(bracket[0], bracket[1]);
  out.push(buildMatch(STAGE.final, realByStage[6][0].Date, realByStage[6][0].IdMatch,
    { team: bracket[0], score: fin.hs, pen: fin.hp }, { team: bracket[1], score: fin.as, pen: fin.ap }));

  out.sort((a, b) => (a.Date ?? '').localeCompare(b.Date ?? ''));
  await mkdir(p('data/simulated'), { recursive: true });
  await writeFile(p('data/simulated/full_tournament.matches.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`Simulated ${out.length} matches. Champion: ${reg.get(fin.win.fifaId).name}, 3rd: ${reg.get(tp.win.fifaId).name}`);

  // --- 4. Snapshots: mask scores (unplayed) and teams (round not yet revealed) ---
  const depthOf = (m) => STAGE_DEPTH[txt(m.StageName)] ?? 0;
  const groupMD1 = out.filter((m) => depthOf(m) === 0).slice(0, 24).map((m) => m.IdMatch);
  const r16First4 = out.filter((m) => depthOf(m) === 2).slice(0, 4).map((m) => m.IdMatch);

  const SNAPSHOTS = {
    '00-start': () => false,
    '01-group-md1': (m) => groupMD1.includes(m.IdMatch),
    '02-group-complete': (m) => depthOf(m) === 0,
    '03-r16-half': (m) => depthOf(m) <= 1 || r16First4.includes(m.IdMatch),
    '04-finished': () => true,
  };

  await mkdir(p('data/snapshots'), { recursive: true });
  const now = '2026-07-19T22:00:00Z';
  for (const [name, isPlayed] of Object.entries(SNAPSHOTS)) {
    const playedByDepth = {};
    for (let d = 0; d <= 6; d++) playedByDepth[d] = out.filter((m) => depthOf(m) === d).every((m) => isPlayed(m)) && out.some((m) => depthOf(m) === d);
    const revealed = (d) => d === 0 || playedByDepth[d - 1];

    const masked = out.map((m) => {
      const d = depthOf(m);
      const played = isPlayed(m);
      if (!revealed(d)) {
        // round not set yet: strip teams to placeholders
        return { ...m, Home: null, Away: null, PlaceHolderA: 'TBD', PlaceHolderB: 'TBD',
          HomeTeamScore: null, AwayTeamScore: null, HomeTeamPenaltyScore: null, AwayTeamPenaltyScore: null, Winner: null };
      }
      if (played) return m;
      return { ...m, HomeTeamScore: null, AwayTeamScore: null, HomeTeamPenaltyScore: null, AwayTeamPenaltyScore: null,
        Home: m.Home ? { ...m.Home, Score: null } : null, Away: m.Away ? { ...m.Away, Score: null } : null, Winner: null };
    });

    const results = compute(draw, masked, now);
    await writeFile(p('data/snapshots', `${name}.json`), JSON.stringify(results, null, 2) + '\n');
    const fr = results.prizes;
    console.log(`  ${name}: ${results.meta.playedMatches}/104 played | winner=${fr.first.winner?.name ?? '—'} | bestT2=${fr.third.leaders.map((t) => t.name).join('/')} | shrew=${fr.fourth.leaders.map((t) => t.name).join('/')}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
