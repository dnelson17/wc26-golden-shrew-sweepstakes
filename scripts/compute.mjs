// Pure data transforms: FIFA match list + sweepstake draw -> prize standings.
// No IO here so it can be unit-tested with synthetic matches.

// --- Raw input shapes ---------------------------------------------------
// The FIFA `/calendar/matches` payload. Only the fields actually read below
// are typed; the live API carries many more we ignore.

/**
 * A localised-text array as FIFA returns it (e.g. StageName, TeamName). Only
 * the first entry's `Description` is ever read (`txt()`).
 * @typedef {{ Description: string | null }[]} FifaText
 */

/**
 * One side (Home/Away) of a raw FIFA match. Null/absent until a knockout slot
 * resolves to a real team.
 * @typedef {object} RawTeam
 * @property {string} [IdTeam]
 * @property {FifaText} [TeamName]
 * @property {string | null} [Abbreviation]
 * @property {number | null} [Score]
 */

/**
 * A stadium block on a raw FIFA match.
 * @typedef {object} RawStadium
 * @property {FifaText} [Name]
 * @property {FifaText} [CityName]
 */

/**
 * One raw FIFA match from `data.Results`. Tolerant of pre-match nulls and
 * unresolved knockout slots; every field consumed by `normalizeMatch` is here.
 * @typedef {object} RawMatch
 * @property {string} IdMatch
 * @property {string} IdStage
 * @property {FifaText} [StageName]
 * @property {number | null} [HomeTeamScore]
 * @property {number | null} [AwayTeamScore]
 * @property {number} [MatchStatus]
 * @property {string | null} [Date]
 * @property {string | null} [MatchTime]
 * @property {FifaText} [GroupName]
 * @property {RawStadium | null} [Stadium]
 * @property {number | null} [ResultType]
 * @property {RawTeam | null} [Home]
 * @property {RawTeam | null} [Away]
 * @property {string | null} [PlaceHolderA]
 * @property {string | null} [PlaceHolderB]
 * @property {number | null} [HomeTeamPenaltyScore]
 * @property {number | null} [AwayTeamPenaltyScore]
 * @property {string | null} [Winner]
 * @property {FifaText} [CompetitionName]
 * @property {string} [IdCompetition]
 * @property {string} [IdSeason]
 */

/**
 * A drawn team as stored in `data/draw_results.json` (richer than the
 * projected `TeamRef`: carries the source FIFA name/country codes).
 * @typedef {object} DrawTeam
 * @property {string} name
 * @property {string} fifaName
 * @property {string} fifaId
 * @property {string} idCountry
 * @property {string} iso2
 */

/**
 * A sweepstake participant in a tiered-pair draw and their two drawn teams.
 * @typedef {object} DrawPerson
 * @property {string} name
 * @property {DrawTeam} group1
 * @property {DrawTeam} group2
 */

/** How a league assigns teams to players. @typedef {'tiered-pair' | 'full-group'} OwnershipMode */

/** Optional pinned FIFA identifiers carried by a draw. @typedef {{ idCompetition?: string, idSeason?: string }} DrawMeta */

/**
 * A tiered-pair draw (the Golden Shrew shape): every player owns one strong
 * (`group1`) and one weak (`group2`) team, with all 48 teams enumerated.
 * @typedef {object} TieredDraw
 * @property {'tiered-pair'} [ownershipMode]
 * @property {DrawPerson[]} people
 * @property {DrawMeta} [meta]
 */

/**
 * A full-group draw: every player owns a whole FIFA group (A–L). Teams are
 * listed once in `teams`; ownership is resolved at compute time from each
 * team's live group letter via `groupOwners` (e.g. `{ A: "David", … }`).
 * @typedef {object} FullGroupDraw
 * @property {'full-group'} ownershipMode
 * @property {Record<string, string>} groupOwners
 * @property {DrawTeam[]} teams
 * @property {DrawMeta} [meta]
 */

/**
 * The full `data/draw_results.json` payload — either ownership shape.
 * @typedef {TieredDraw | FullGroupDraw} Draw
 */

// --- Internal working shapes --------------------------------------------

/**
 * The flat per-match shape produced by `normalizeMatch`.
 * @typedef {object} NormSide
 * @property {string} id
 * @property {string | null} name
 * @property {string | null | undefined} abbr
 * @property {number | null} score
 */

/**
 * One normalized match: pre-match nulls tolerated, knockout placeholders kept.
 * @typedef {object} NormMatch
 * @property {string} id
 * @property {string} stageId
 * @property {string | null} stageName
 * @property {number} depth
 * @property {boolean} isKnockout
 * @property {string | null} date
 * @property {boolean} played
 * @property {boolean} live
 * @property {string | null} matchTime
 * @property {string | null} group
 * @property {import('../src/types').Venue | null} venue
 * @property {number | null} resultType
 * @property {NormSide | null} home
 * @property {NormSide | null} away
 * @property {string | null} placeholderA
 * @property {string | null} placeholderB
 * @property {number | null} homePen
 * @property {number | null} awayPen
 * @property {string | null} winner
 */

/**
 * The mutable per-team accumulator held in the registry. A superset of the
 * projected `TeamRef`: also carries played count, whole-tournament goals, the
 * source FIFA name/country codes, and the running abbreviation.
 * @typedef {object} RegTeam
 * @property {string} fifaId
 * @property {string} name
 * @property {string} fifaName
 * @property {string | null | undefined} abbr
 * @property {string} iso2
 * @property {string} idCountry
 * @property {string} owner
 * @property {import('../src/types').Tier | null} tier
 * @property {string | null} group
 * @property {number} p
 * @property {number} w
 * @property {number} d
 * @property {number} l
 * @property {number} gf
 * @property {number} ga
 * @property {number} gd
 * @property {number} pts
 * @property {number} ogf
 * @property {number} oga
 * @property {number} [ogd]
 * @property {number} furthestDepth
 * @property {boolean} eliminated
 * @property {boolean} [qualified]
 * @property {boolean} champion
 * @property {boolean} runnerUp
 * @property {boolean} thirdPlace
 * @property {import('../src/types').PrizeStatus} [status]
 */

// Stage depth: how far a team progressed. Keyed by StageName (stable FIFA labels),
// with IdStage fallback for the 2026 season in case labels shift.
/** @type {Record<string, number>} */
export const STAGE_DEPTH = {
  'First Stage': 0,
  'Round of 32': 1,
  'Round of 16': 2,
  'Quarter-final': 3,
  'Semi-final': 4,
  'Play-off for third place': 5,
  Final: 6,
};

/** @type {Record<string, number>} */
const STAGE_ID_DEPTH = {
  289273: 0,
  289287: 1,
  289288: 2,
  289289: 3,
  289290: 4,
  289291: 5,
  289292: 6,
};

/** @type {Record<number, string>} */
export const DEPTH_LABEL = {
  0: 'Group stage',
  1: 'Round of 32',
  2: 'Round of 16',
  3: 'Quarter-final',
  4: 'Semi-final',
  5: 'Third place',
  6: 'Final',
};

const FINAL_ID = '289292';
const THIRD_ID = '289291';

/** @param {FifaText | null | undefined} arr */
const txt = (arr) => (Array.isArray(arr) && arr[0] ? arr[0].Description : null);

/** @param {RawMatch} m */
function depthOf(m) {
  const byName = STAGE_DEPTH[txt(m.StageName) ?? ''];
  if (byName !== undefined) return byName;
  const byId = STAGE_ID_DEPTH[m.IdStage];
  return byId ?? 0;
}

// Normalize one raw FIFA match into a flat shape. Tolerates pre-match nulls
// and unresolved knockout slots (Home/Away null -> placeholder strings).
/**
 * @param {RawMatch} m
 * @returns {NormMatch}
 */
export function normalizeMatch(m) {
  const depth = depthOf(m);
  const hs = m.HomeTeamScore ?? m.Home?.Score ?? null;
  const as = m.AwayTeamScore ?? m.Away?.Score ?? null;
  // FIFA MatchStatus: 0 = finished, 1 = not started, 3 = live (in progress).
  // A live match already carries a running score, so a result is only final when it
  // is NOT live — otherwise an in-play scoreline would leak into the standings.
  const live = m.MatchStatus === 3;
  const played = hs !== null && as !== null && !live;
  return {
    id: m.IdMatch,
    stageId: m.IdStage,
    stageName: txt(m.StageName),
    depth,
    isKnockout: depth >= 1,
    date: m.Date ?? null,
    played,
    live,
    matchTime: m.MatchTime ?? null,
    group: (txt(m.GroupName) || '').replace(/^Group\s+/i, '') || null,
    venue: m.Stadium ? { name: txt(m.Stadium.Name), city: txt(m.Stadium.CityName) } : null,
    resultType: m.ResultType ?? null,
    home: m.Home?.IdTeam
      ? { id: m.Home.IdTeam, name: txt(m.Home.TeamName), abbr: m.Home.Abbreviation, score: hs }
      : null,
    away: m.Away?.IdTeam
      ? { id: m.Away.IdTeam, name: txt(m.Away.TeamName), abbr: m.Away.Abbreviation, score: as }
      : null,
    placeholderA: m.PlaceHolderA ?? null,
    placeholderB: m.PlaceHolderB ?? null,
    homePen: m.HomeTeamPenaltyScore ?? null,
    awayPen: m.AwayTeamPenaltyScore ?? null,
    winner: m.Winner ?? null,
  };
}

// One zeroed registry entry from a drawn team.
/**
 * @param {DrawTeam} t
 * @param {string} owner
 * @param {import('../src/types').Tier | null} tier
 * @returns {RegTeam}
 */
function makeRegTeam(t, owner, tier) {
  return {
    fifaId: t.fifaId,
    name: t.name,
    fifaName: t.fifaName,
    abbr: null,
    iso2: t.iso2,
    idCountry: t.idCountry,
    owner,
    tier,
    group: null,
    // group-stage table
    p: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    pts: 0,
    // whole-tournament goals (prize-3 tiebreak)
    ogf: 0,
    oga: 0,
    furthestDepth: 0,
    eliminated: false,
    champion: false,
    runnerUp: false,
    thirdPlace: false,
  };
}

// Flatten the draw into a per-team registry keyed by fifaId. Tiered-pair draws
// carry owner + tier directly; full-group draws list every team once with
// ownership resolved later (in `compute`) from each team's live group letter.
/**
 * @param {Draw} draw
 * @returns {Map<string, RegTeam>}
 */
function buildRegistry(draw) {
  /** @type {Map<string, RegTeam>} */
  const reg = new Map();
  if (draw.ownershipMode === 'full-group') {
    for (const t of draw.teams) reg.set(t.fifaId, makeRegTeam(t, '', null));
  } else {
    for (const person of draw.people) {
      for (const tier of /** @type {const} */ ([1, 2])) {
        const t = person[`group${tier}`];
        reg.set(t.fifaId, makeRegTeam(t, person.name, tier));
      }
    }
  }
  return reg;
}

/**
 * @param {Draw} draw
 * @param {RawMatch[]} rawMatches
 * @param {string} nowIso
 * @returns {import('../src/types').Results}
 */
export function compute(draw, rawMatches, nowIso) {
  const matches = rawMatches.map(normalizeMatch);
  const reg = buildRegistry(draw);

  const groupMatches = matches.filter((m) => m.depth === 0);
  const groupComplete = groupMatches.length > 0 && groupMatches.every((m) => m.played);

  // Teams that appear (real id) in any knockout fixture — they advanced from groups.
  /** @type {Set<string>} */
  const inKnockout = new Set();
  for (const m of matches) {
    if (!m.isKnockout) continue;
    if (m.home?.id) inKnockout.add(m.home.id);
    if (m.away?.id) inKnockout.add(m.away.id);
  }

  // Accumulate stats over played matches; track furthest stage by appearance.
  for (const m of matches) {
    for (const side of /** @type {const} */ (['home', 'away'])) {
      const s = m[side];
      if (!s?.id) continue;
      const t = reg.get(s.id);
      if (!t) continue; // team not in our sweepstake (shouldn't happen — all 48 are)
      if (m.depth > t.furthestDepth) t.furthestDepth = m.depth;
      if (s.abbr && !t.abbr) t.abbr = s.abbr;
      if (m.depth === 0 && m.group && !t.group) t.group = m.group;
    }
    if (!m.played || !m.home?.id || !m.away?.id) continue;
    const h = reg.get(m.home.id);
    const a = reg.get(m.away.id);
    if (!h || !a) continue;
    const hScore = m.home.score,
      aScore = m.away.score;
    if (hScore == null || aScore == null) continue; // played implies scores, narrows nulls
    // whole-tournament goals (excludes shootout)
    h.ogf += hScore;
    h.oga += aScore;
    a.ogf += aScore;
    a.oga += hScore;
    // group-stage table only
    if (m.depth === 0) {
      h.p++;
      a.p++;
      h.gf += hScore;
      h.ga += aScore;
      a.gf += aScore;
      a.ga += hScore;
      if (hScore > aScore) {
        h.w++;
        a.l++;
        h.pts += 3;
      } else if (hScore < aScore) {
        a.w++;
        h.l++;
        a.pts += 3;
      } else {
        h.d++;
        a.d++;
        h.pts++;
        a.pts++;
      }
    }
  }

  for (const t of reg.values()) {
    t.gd = t.gf - t.ga;
    t.ogd = t.ogf - t.oga;
  }

  // Full-group leagues resolve ownership now that each team's group letter is
  // known (from the group-stage fixtures). Teams whose group isn't published
  // yet stay unowned and simply don't roll up to a player until it is.
  if (draw.ownershipMode === 'full-group') {
    const owners = draw.groupOwners;
    for (const t of reg.values()) t.owner = (t.group && owners[t.group]) || '';
  }

  // Eliminations: derive from the bracket rather than computing group standings.
  for (const t of reg.values()) {
    const teamMatches = matches.filter((m) => m.home?.id === t.fifaId || m.away?.id === t.fifaId);
    const deepest = teamMatches.reduce(
      (/** @type {NormMatch | null} */ acc, m) => (m.depth >= (acc?.depth ?? -1) ? m : acc),
      /** @type {NormMatch | null} */ (null),
    );
    if (!deepest) continue;
    if (!deepest.played) {
      t.eliminated = false;
      continue;
    }
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
  const finalM = matches.find((m) => m.stageId === FINAL_ID) ?? matches.find((m) => m.depth === 6);
  const thirdM = matches.find((m) => m.stageId === THIRD_ID) ?? matches.find((m) => m.depth === 5);
  const champion = finalM?.played ? finalM.winner : null;
  const third = thirdM?.played ? thirdM.winner : null;
  if (champion && finalM) {
    const champTeam = reg.get(champion);
    if (champTeam) champTeam.champion = true;
    const ru = [finalM.home?.id, finalM.away?.id].find((id) => id && id !== champion);
    const ruTeam = ru ? reg.get(ru) : undefined;
    if (ruTeam) ruTeam.runnerUp = true;
  }
  if (third) {
    const thirdTeam = reg.get(third);
    if (thirdTeam) thirdTeam.thirdPlace = true;
  }

  const teams = [...reg.values()];
  for (const t of teams) t.qualified = inKnockout.has(t.fifaId);

  // Prize 3: best group-2 team. Furthest depth, then most goals, then fewest conceded.
  // Leagues without tiered teams (full-group) have no tier-2 pool, so this is empty.
  const tier2 = teams
    .filter((t) => t.tier === 2)
    .sort((x, y) => y.furthestDepth - x.furthestDepth || y.ogf - x.ogf || x.oga - y.oga);
  const bestT2 = tier2[0]; // undefined when a league doesn't tier teams
  const t3Shared = bestT2
    ? tier2.filter(
        (t) =>
          t.furthestDepth === bestT2.furthestDepth && t.ogf === bestT2.ogf && t.oga === bestT2.oga,
      )
    : [];

  // Prize 4: wooden shrew. Least pts, worst GD, most conceded, fewest scored.
  const spoon = [...teams].sort(
    (x, y) => x.pts - y.pts || x.gd - y.gd || y.ga - x.ga || x.gf - y.gf,
  );
  const worst = /** @type {RegTeam} */ (spoon[0]); // 48 teams; always present
  const t4Shared = spoon.filter(
    (t) => t.pts === worst.pts && t.gd === worst.gd && t.ga === worst.ga && t.gf === worst.gf,
  );

  // Prize 5: worst group-1 side (bucket-hat spot prize). The weakest of the
  // strong (tier-1) teams by group-stage record: least pts, then most conceded,
  // then fewest scored. Leagues without tiered teams (full-group) have no tier-1
  // pool, so this is empty and reads 'na' for every team.
  const group1 = teams
    .filter((t) => t.tier === 1)
    .sort((x, y) => x.pts - y.pts || y.ga - x.ga || x.gf - y.gf);
  const worstG1 = group1[0]; // undefined when a league doesn't tier teams
  const t5Shared = worstG1
    ? group1.filter((t) => t.pts === worstG1.pts && t.ga === worstG1.ga && t.gf === worstG1.gf)
    : [];

  const playedCount = matches.filter((m) => m.played).length;
  const tournamentOver = !!champion;

  // --- Per-team prize status: won | lost | ongoing | na ---
  const tier2Leaders = new Set(t3Shared.map((t) => t.fifaId));
  const shrewLeaders = new Set(t4Shared.map((t) => t.fifaId));
  const worstG1Leaders = new Set(t5Shared.map((t) => t.fifaId));
  const thirdLoserId = thirdM?.played
    ? [thirdM.home?.id, thirdM.away?.id].find((id) => id && id !== third)
    : null;

  /**
   * @param {RegTeam} t
   * @returns {import('../src/types').PrizeStatus}
   */
  const statusFor = (t) => {
    // 🏆 Winner
    /** @type {import('../src/types').Status} */
    const winner = t.champion ? 'won' : t.eliminated ? 'lost' : 'ongoing';
    // 🥉 Third place (win the 3rd-place playoff)
    /** @type {import('../src/types').Status} */
    let third_;
    if (t.thirdPlace) third_ = 'won';
    else if (t.furthestDepth === 6)
      third_ = 'lost'; // reached the final → can't be 3rd
    else if (thirdLoserId === t.fifaId)
      third_ = 'lost'; // lost the 3rd-place playoff
    else if (t.eliminated && t.furthestDepth <= 3)
      third_ = 'lost'; // out in QF or earlier
    else third_ = 'ongoing'; // alive, in SF, or 3rd-place game pending
    // 🪖 Best group-2 (only group-2 teams are eligible; 'na' when untiered)
    /** @type {import('../src/types').Status} */
    let bestGroup2;
    if (t.tier !== 2) bestGroup2 = 'na';
    else if (tournamentOver) bestGroup2 = tier2Leaders.has(t.fifaId) ? 'won' : 'lost';
    else if (tier2Leaders.has(t.fifaId))
      bestGroup2 = 'ongoing'; // currently leading
    else if (t.eliminated)
      bestGroup2 = 'lost'; // out and behind the leader
    else bestGroup2 = 'ongoing';
    // 🪵 Wooden shrew (decided once the group stage is complete)
    /** @type {import('../src/types').Status} */
    const shrew = groupComplete ? (shrewLeaders.has(t.fifaId) ? 'won' : 'lost') : 'ongoing';
    // 🧢 Worst group-1 (only group-1 teams eligible; 'na' otherwise). Like the
    // shrew, decided once the group stage is complete.
    /** @type {import('../src/types').Status} */
    let worstGroup1;
    if (t.tier !== 1) worstGroup1 = 'na';
    else worstGroup1 = groupComplete ? (worstG1Leaders.has(t.fifaId) ? 'won' : 'lost') : 'ongoing';
    return { winner, third: third_, bestGroup2, shrew, worstGroup1 };
  };
  for (const t of teams) t.status = statusFor(t);

  // won beats ongoing beats lost; 'na'/absent ignored. Rolls a player's teams up.
  /**
   * @param {(import('../src/types').Status | undefined)[]} ss
   * @returns {import('../src/types').Status}
   */
  const combine = (...ss) => {
    const f = ss.filter((s) => s != null && s !== 'na');
    if (!f.length) return 'na';
    if (f.includes('won')) return 'won';
    if (f.includes('ongoing')) return 'ongoing';
    return 'lost';
  };

  /**
   * Project a registry entry to the client `TeamRef`. `qualified`/`status` are
   * set on every team before `ref` runs; an absent `t` (unresolved slot) → undefined.
   * @param {RegTeam | undefined} t
   * @returns {import('../src/types').TeamRef | undefined}
   */
  const ref = (t) =>
    t && {
      fifaId: t.fifaId,
      name: t.name,
      owner: t.owner,
      tier: t.tier,
      group: t.group,
      iso2: t.iso2,
      furthestDepth: t.furthestDepth,
      furthestLabel: DEPTH_LABEL[t.furthestDepth] ?? 'Group stage',
      pts: t.pts,
      w: t.w,
      d: t.d,
      l: t.l,
      gf: t.gf,
      ga: t.ga,
      gd: t.gd,
      ogf: t.ogf,
      oga: t.oga,
      eliminated: t.eliminated,
      qualified: /** @type {boolean} */ (t.qualified),
      champion: t.champion,
      runnerUp: t.runnerUp,
      thirdPlace: t.thirdPlace,
      status: /** @type {import('../src/types').PrizeStatus} */ (t.status),
    };

  // All matches as flat fixtures (for the schedule view); knockout is the depth>=1 subset
  // used by the bracket. Unrevealed rounds keep their placeholders. Times are UTC —
  // the client formats them to Europe/London (BST during the tournament).
  /**
   * @param {NormMatch} m
   * @returns {import('../src/types').Fixture}
   */
  const toFixture = (m) => {
    // Result note for finished games. Penalties are reliable (pen score present);
    // 'a.e.t.' is inferred from ResultType beyond regular time (1) — provisional until
    // the first extra-time match confirms the enum.
    const result = !m.played
      ? null
      : m.homePen != null
        ? 'on penalties'
        : (m.resultType ?? 0) > 1
          ? 'a.e.t.'
          : null;
    return {
      matchId: m.id,
      depth: m.depth,
      stage: m.depth === 0 ? 'Group stage' : (DEPTH_LABEL[m.depth] ?? 'Group stage'),
      date: m.date,
      played: m.played,
      live: m.live,
      matchTime: m.live ? m.matchTime : null,
      group: m.group,
      venue: m.venue,
      result,
      home: m.home?.id ? (ref(reg.get(m.home.id)) ?? null) : null,
      away: m.away?.id ? (ref(reg.get(m.away.id)) ?? null) : null,
      homePlaceholder: m.placeholderA,
      awayPlaceholder: m.placeholderB,
      homeScore: m.home?.score ?? null,
      awayScore: m.away?.score ?? null,
      homePen: m.homePen,
      awayPen: m.awayPen,
      winnerId: m.winner,
    };
  };
  const fixtures = matches
    .map(toFixture)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const knockout = fixtures.filter((f) => f.depth >= 1);

  // Full combined table in wooden-shrew order; `qualified` marks knockout teams so
  // the shrew view can isolate the 16 non-qualifiers.
  const leagueTable = spoon.map((t, i) => ({
    rank: i + 1,
    .../** @type {import('../src/types').TeamRef} */ (ref(t)),
  }));

  // --- Per-player rollup: group each owner's teams, combine their statuses ---
  // Uniform across ownership modes: `combine` ignores 'na', so a tiered player's
  // best-group-2 falls through to their group-2 team, and an untiered player's
  // is simply 'na' across the board.
  /** @type {Map<string, RegTeam[]>} */
  const teamsByOwner = new Map();
  for (const t of teams) {
    const owned = teamsByOwner.get(t.owner);
    if (owned) owned.push(t);
    else teamsByOwner.set(t.owner, [t]);
  }
  const ownerOrder =
    draw.ownershipMode === 'full-group'
      ? Object.values(draw.groupOwners)
      : draw.people.map((person) => person.name);
  /** @type {string[]} */
  const orderedOwners = [];
  const seenOwner = new Set();
  for (const name of ownerOrder) {
    if (name && !seenOwner.has(name)) {
      seenOwner.add(name);
      orderedOwners.push(name);
    }
  }
  const people = orderedOwners.map((name) => {
    const owned = teamsByOwner.get(name) ?? [];
    const ss = owned.map((t) => /** @type {import('../src/types').PrizeStatus} */ (t.status));
    return {
      name,
      teams: /** @type {import('../src/types').TeamRef[]} */ (owned.map(ref)),
      status: {
        winner: combine(...ss.map((s) => s.winner)),
        third: combine(...ss.map((s) => s.third)),
        bestGroup2: combine(...ss.map((s) => s.bestGroup2)),
        shrew: combine(...ss.map((s) => s.shrew)),
        worstGroup1: combine(...ss.map((s) => s.worstGroup1)),
      },
    };
  });

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
      first: /** @type {import('../src/types').CapstonePrize} */ ({
        label: 'Winner — £120',
        emoji: '🏆',
        status: champion ? 'decided' : 'pending',
        winner: ref(champion ? reg.get(champion) : undefined),
      }),
      second: /** @type {import('../src/types').CapstonePrize} */ ({
        label: '3rd place — £40',
        emoji: '🥉',
        status: third ? 'decided' : 'pending',
        winner: ref(third ? reg.get(third) : undefined),
      }),
      third: {
        label: 'Best group-2 side — £40',
        emoji: '🪖',
        status: tournamentOver ? 'decided' : 'leading',
        leaders: /** @type {import('../src/types').TeamRef[]} */ (t3Shared.map(ref)),
        standings: /** @type {import('../src/types').TeamRef[]} */ (tier2.map(ref)),
      },
      fourth: {
        label: 'Wooden shrew — £40',
        emoji: '🪵',
        status: groupComplete ? 'decided' : 'leading',
        leaders: /** @type {import('../src/types').TeamRef[]} */ (t4Shared.map(ref)),
        standings: /** @type {import('../src/types').TeamRef[]} */ (spoon.slice(0, 6).map(ref)),
      },
      fifth: {
        label: 'Worst group-1 side — bucket hat',
        emoji: '🧢',
        status: groupComplete ? 'decided' : 'leading',
        leaders: /** @type {import('../src/types').TeamRef[]} */ (t5Shared.map(ref)),
        standings: /** @type {import('../src/types').TeamRef[]} */ (group1.map(ref)),
      },
    },
    fixtures,
    knockout,
    leagueTable,
    teams: /** @type {import('../src/types').TeamRef[]} */ (
      teams.sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || a.owner.localeCompare(b.owner)).map(ref)
    ),
    people,
  };
}
