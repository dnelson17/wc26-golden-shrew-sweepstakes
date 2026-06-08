// Pure data transforms: FIFA match list + sweepstake draw -> prize standings.
// No IO here so it can be unit-tested with synthetic matches.

// Stage depth: how far a team progressed. Keyed by StageName (stable FIFA labels),
// with IdStage fallback for the 2026 season in case labels shift.
export const STAGE_DEPTH = {
  'First Stage': 0,
  'Round of 32': 1,
  'Round of 16': 2,
  'Quarter-final': 3,
  'Semi-final': 4,
  'Play-off for third place': 5,
  'Final': 6,
};

const STAGE_ID_DEPTH = {
  '289273': 0, '289287': 1, '289288': 2, '289289': 3,
  '289290': 4, '289291': 5, '289292': 6,
};

export const DEPTH_LABEL = {
  0: 'Group stage', 1: 'Round of 32', 2: 'Round of 16', 3: 'Quarter-final',
  4: 'Semi-final', 5: 'Third place', 6: 'Final',
};

const FINAL_ID = '289292';
const THIRD_ID = '289291';

const txt = (arr) => (Array.isArray(arr) && arr[0] ? arr[0].Description : null);

function depthOf(m) {
  const byName = STAGE_DEPTH[txt(m.StageName)];
  if (byName !== undefined) return byName;
  const byId = STAGE_ID_DEPTH[m.IdStage];
  return byId !== undefined ? byId : 0;
}

// Normalize one raw FIFA match into a flat shape. Tolerates pre-match nulls
// and unresolved knockout slots (Home/Away null -> placeholder strings).
export function normalizeMatch(m) {
  const depth = depthOf(m);
  const hs = m.HomeTeamScore ?? m.Home?.Score ?? null;
  const as = m.AwayTeamScore ?? m.Away?.Score ?? null;
  const played = hs !== null && as !== null;
  return {
    id: m.IdMatch,
    stageId: m.IdStage,
    stageName: txt(m.StageName),
    depth,
    isKnockout: depth >= 1,
    date: m.Date ?? null,
    played,
    home: m.Home?.IdTeam ? { id: m.Home.IdTeam, name: txt(m.Home.TeamName), abbr: m.Home.Abbreviation, score: hs } : null,
    away: m.Away?.IdTeam ? { id: m.Away.IdTeam, name: txt(m.Away.TeamName), abbr: m.Away.Abbreviation, score: as } : null,
    placeholderA: m.PlaceHolderA ?? null,
    placeholderB: m.PlaceHolderB ?? null,
    homePen: m.HomeTeamPenaltyScore ?? null,
    awayPen: m.AwayTeamPenaltyScore ?? null,
    winner: m.Winner ?? null,
  };
}

// Flatten the draw into a per-team registry keyed by fifaId.
function buildRegistry(draw) {
  const reg = new Map();
  for (const person of draw.people) {
    for (const tier of [1, 2]) {
      const t = person[`group${tier}`];
      reg.set(t.fifaId, {
        fifaId: t.fifaId,
        name: t.name,
        fifaName: t.fifaName,
        abbr: null,
        iso2: t.iso2,
        idCountry: t.idCountry,
        owner: person.name,
        tier,
        // group-stage table
        p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0,
        // whole-tournament goals (prize-3 tiebreak)
        ogf: 0, oga: 0,
        furthestDepth: 0,
        eliminated: false,
        champion: false,
        runnerUp: false,
        thirdPlace: false,
      });
    }
  }
  return reg;
}

export function compute(draw, rawMatches, nowIso) {
  const matches = rawMatches.map(normalizeMatch);
  const reg = buildRegistry(draw);

  const groupMatches = matches.filter((m) => m.depth === 0);
  const groupComplete = groupMatches.length > 0 && groupMatches.every((m) => m.played);

  // Teams that appear (real id) in any knockout fixture — they advanced from groups.
  const inKnockout = new Set();
  for (const m of matches) {
    if (!m.isKnockout) continue;
    if (m.home?.id) inKnockout.add(m.home.id);
    if (m.away?.id) inKnockout.add(m.away.id);
  }

  // Accumulate stats over played matches; track furthest stage by appearance.
  for (const m of matches) {
    for (const side of ['home', 'away']) {
      const s = m[side];
      if (!s?.id) continue;
      const t = reg.get(s.id);
      if (!t) continue; // team not in our sweepstake (shouldn't happen — all 48 are)
      if (m.depth > t.furthestDepth) t.furthestDepth = m.depth;
      if (s.abbr && !t.abbr) t.abbr = s.abbr;
    }
    if (!m.played || !m.home?.id || !m.away?.id) continue;
    const h = reg.get(m.home.id);
    const a = reg.get(m.away.id);
    if (!h || !a) continue;
    // whole-tournament goals (excludes shootout)
    h.ogf += m.home.score; h.oga += m.away.score;
    a.ogf += m.away.score; a.oga += m.home.score;
    // group-stage table only
    if (m.depth === 0) {
      h.p++; a.p++;
      h.gf += m.home.score; h.ga += m.away.score;
      a.gf += m.away.score; a.ga += m.home.score;
      if (m.home.score > m.away.score) { h.w++; a.l++; h.pts += 3; }
      else if (m.home.score < m.away.score) { a.w++; h.l++; a.pts += 3; }
      else { h.d++; a.d++; h.pts++; a.pts++; }
    }
  }

  for (const t of reg.values()) {
    t.gd = t.gf - t.ga;
    t.ogd = t.ogf - t.oga;
  }

  // Eliminations: derive from the bracket rather than computing group standings.
  for (const t of reg.values()) {
    const teamMatches = matches.filter((m) => m.home?.id === t.fifaId || m.away?.id === t.fifaId);
    const deepest = teamMatches.reduce((acc, m) => (m.depth >= (acc?.depth ?? -1) ? m : acc), null);
    if (!deepest) continue;
    if (!deepest.played) { t.eliminated = false; continue; }
    if (deepest.depth === 0) {
      // group casualty: out once groups complete and they didn't make the knockouts
      t.eliminated = groupComplete && !inKnockout.has(t.fifaId);
    } else if (deepest.depth === 5) {
      // third-place playoff is terminal for both teams (title comes from the final)
      t.eliminated = true;
    } else {
      // lost a knockout tie (Winner set to the other team)
      t.eliminated = deepest.winner != null && deepest.winner !== t.fifaId;
    }
  }

  // Prize 1 + 2: the title decider matches.
  const finalM = matches.find((m) => m.stageId === FINAL_ID) || matches.find((m) => m.depth === 6);
  const thirdM = matches.find((m) => m.stageId === THIRD_ID) || matches.find((m) => m.depth === 5);
  const champion = finalM?.played ? finalM.winner : null;
  const third = thirdM?.played ? thirdM.winner : null;
  if (champion) {
    reg.get(champion) && (reg.get(champion).champion = true);
    const ru = [finalM.home?.id, finalM.away?.id].find((id) => id && id !== champion);
    ru && reg.get(ru) && (reg.get(ru).runnerUp = true);
  }
  if (third) reg.get(third) && (reg.get(third).thirdPlace = true);

  const teams = [...reg.values()];
  for (const t of teams) t.qualified = inKnockout.has(t.fifaId);

  // Prize 3: best group-2 team. Furthest depth, then most goals, then fewest conceded.
  const tier2 = teams.filter((t) => t.tier === 2)
    .sort((x, y) => y.furthestDepth - x.furthestDepth || y.ogf - x.ogf || x.oga - y.oga);
  const bestT2 = tier2[0];
  const t3Shared = tier2.filter((t) =>
    t.furthestDepth === bestT2.furthestDepth && t.ogf === bestT2.ogf && t.oga === bestT2.oga);

  // Prize 4: wooden shrew. Least pts, worst GD, most conceded, fewest scored.
  const spoon = [...teams]
    .sort((x, y) => x.pts - y.pts || x.gd - y.gd || y.ga - x.ga || x.gf - y.gf);
  const worst = spoon[0];
  const t4Shared = spoon.filter((t) =>
    t.pts === worst.pts && t.gd === worst.gd && t.ga === worst.ga && t.gf === worst.gf);

  const playedCount = matches.filter((m) => m.played).length;
  const tournamentOver = !!champion;

  // --- Per-team prize status: won | lost | ongoing | na ---
  const tier2Leaders = new Set(t3Shared.map((t) => t.fifaId));
  const shrewLeaders = new Set(t4Shared.map((t) => t.fifaId));
  const thirdLoserId = thirdM?.played
    ? [thirdM.home?.id, thirdM.away?.id].find((id) => id && id !== third) : null;

  const statusFor = (t) => {
    // 🏆 Winner
    const winner = t.champion ? 'won' : t.eliminated ? 'lost' : 'ongoing';
    // 🥉 Third place (win the 3rd-place playoff)
    let third_;
    if (t.thirdPlace) third_ = 'won';
    else if (t.furthestDepth === 6) third_ = 'lost';        // reached the final → can't be 3rd
    else if (thirdLoserId === t.fifaId) third_ = 'lost';    // lost the 3rd-place playoff
    else if (t.eliminated && t.furthestDepth <= 3) third_ = 'lost'; // out in QF or earlier
    else third_ = 'ongoing';                                 // alive, in SF, or 3rd-place game pending
    // 🪖 Best group-2 (only group-2 teams are eligible)
    let bestGroup2;
    if (t.tier === 1) bestGroup2 = 'na';
    else if (tournamentOver) bestGroup2 = tier2Leaders.has(t.fifaId) ? 'won' : 'lost';
    else if (tier2Leaders.has(t.fifaId)) bestGroup2 = 'ongoing'; // currently leading
    else if (t.eliminated) bestGroup2 = 'lost';                  // out and behind the leader
    else bestGroup2 = 'ongoing';
    // 🪵 Wooden shrew (decided once the group stage is complete)
    const shrew = groupComplete ? (shrewLeaders.has(t.fifaId) ? 'won' : 'lost') : 'ongoing';
    return { winner, third: third_, bestGroup2, shrew };
  };
  for (const t of teams) t.status = statusFor(t);

  // won beats ongoing beats lost; 'na' ignored. Used to roll a player's two teams up.
  const combine = (...ss) => {
    const f = ss.filter((s) => s && s !== 'na');
    if (!f.length) return 'na';
    if (f.includes('won')) return 'won';
    if (f.includes('ongoing')) return 'ongoing';
    return 'lost';
  };

  const ref = (t) => t && {
    fifaId: t.fifaId, name: t.name, owner: t.owner, tier: t.tier, iso2: t.iso2,
    furthestDepth: t.furthestDepth, furthestLabel: DEPTH_LABEL[t.furthestDepth],
    pts: t.pts, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga, gd: t.gd, ogf: t.ogf, oga: t.oga,
    eliminated: t.eliminated, qualified: t.qualified, champion: t.champion,
    runnerUp: t.runnerUp, thirdPlace: t.thirdPlace, status: t.status,
  };

  // Knockout matches for the bracket view. Unrevealed rounds keep their placeholders.
  const knockout = matches.filter((m) => m.depth >= 1)
    .sort((a, b) => a.depth - b.depth || (a.date ?? '').localeCompare(b.date ?? ''))
    .map((m) => ({
      matchId: m.id, depth: m.depth, stage: DEPTH_LABEL[m.depth], date: m.date, played: m.played,
      home: m.home?.id ? ref(reg.get(m.home.id)) : null,
      away: m.away?.id ? ref(reg.get(m.away.id)) : null,
      homePlaceholder: m.placeholderA, awayPlaceholder: m.placeholderB,
      homeScore: m.home?.score ?? null, awayScore: m.away?.score ?? null,
      homePen: m.homePen, awayPen: m.awayPen, winnerId: m.winner,
    }));

  // Full combined table in wooden-shrew order; `qualified` marks knockout teams so
  // the shrew view can isolate the 16 non-qualifiers.
  const leagueTable = spoon.map((t, i) => ({ rank: i + 1, ...ref(t) }));

  return {
    meta: {
      updatedAt: nowIso,
      idCompetition: draw.meta?.idCompetition ?? '17',
      idSeason: draw.meta?.idSeason ?? '285023',
      totalMatches: matches.length,
      playedMatches: playedCount,
      groupComplete,
      tournamentOver,
      source: 'https://api.fifa.com/api/v3/calendar/matches',
    },
    prizes: {
      first: { label: 'Winner — £120', emoji: '🏆', status: champion ? 'decided' : 'pending', winner: ref(reg.get(champion)) },
      second: { label: '3rd place — £40', emoji: '🥉', status: third ? 'decided' : 'pending', winner: ref(reg.get(third)) },
      third: {
        label: 'Best group-2 side — £40', emoji: '🪖',
        status: tournamentOver ? 'decided' : 'leading',
        leaders: t3Shared.map(ref),
        standings: tier2.map(ref),
      },
      fourth: {
        label: 'Wooden shrew — £40', emoji: '🪵',
        status: groupComplete ? 'decided' : 'leading',
        leaders: t4Shared.map(ref),
        standings: spoon.slice(0, 6).map(ref),
      },
    },
    knockout,
    leagueTable,
    teams: teams.sort((a, b) => a.tier - b.tier || a.owner.localeCompare(b.owner)).map(ref),
    people: draw.people.map((p) => {
      const g1 = reg.get(p.group1.fifaId);
      const g2 = reg.get(p.group2.fifaId);
      return {
        name: p.name,
        group1: ref(g1),
        group2: ref(g2),
        status: {
          winner: combine(g1.status.winner, g2.status.winner),
          third: combine(g1.status.third, g2.status.third),
          bestGroup2: g2.status.bestGroup2, // only the group-2 team is eligible
          shrew: combine(g1.status.shrew, g2.status.shrew),
        },
      };
    }),
  };
}
