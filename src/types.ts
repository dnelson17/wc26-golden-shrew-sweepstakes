// Shared shape of data/results.json — the contract between the build-time data
// pipeline (scripts/compute.mjs `ref`/`toFixture`) and the client dashboard.
// Both sides reference these types so a change to the JSON shape breaks the
// compiler on both ends rather than at runtime.

/** Per-prize state for a single team or player. */
export type Status = 'won' | 'lost' | 'ongoing' | 'na';

/** The four sweepstake prizes, keyed by their stable identifiers. */
export interface PrizeStatus {
  winner: Status;
  third: Status;
  bestGroup2: Status;
  shrew: Status;
}

/** One of the four prize keys. */
export type PrizeKey = keyof PrizeStatus;

/**
 * In a tiered-pair league, which pool a team was drawn into (1 = strong,
 * 2 = weak). `null` in leagues that don't tier teams (e.g. full-group).
 */
export type Tier = 1 | 2;

/**
 * A team as projected for the client (the output of `ref()` in compute.mjs).
 * Carries the group-stage table, whole-tournament goal tallies (prize tiebreaks)
 * and the derived per-prize status.
 */
export interface TeamRef {
  fifaId: string;
  name: string;
  owner: string;
  tier: Tier | null;
  group: string | null;
  iso2: string;
  furthestDepth: number;
  furthestLabel: string;
  pts: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  ogf: number;
  oga: number;
  eliminated: boolean;
  qualified: boolean;
  champion: boolean;
  runnerUp: boolean;
  thirdPlace: boolean;
  status: PrizeStatus;
}

/** A team row in the combined wooden-shrew table (a TeamRef plus its rank). */
export interface LeagueRow extends TeamRef {
  rank: number;
}

/** Where a fixture is played, when FIFA has published it. */
export interface Venue {
  name: string | null;
  city: string | null;
}

/**
 * A flat fixture for both the schedule and the bracket. Unrevealed knockout
 * slots have null `home`/`away` and fall back to placeholder strings (e.g. "2A").
 */
export interface Fixture {
  matchId: string;
  depth: number;
  stage: string;
  date: string | null;
  played: boolean;
  live: boolean;
  matchTime: string | null;
  group: string | null;
  venue: Venue | null;
  result: string | null;
  home: TeamRef | null;
  away: TeamRef | null;
  homePlaceholder: string | null;
  awayPlaceholder: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homePen: number | null;
  awayPen: number | null;
  winnerId: string | null;
}

/** A single-winner prize (champion, third place). `winner` is absent until decided. */
export interface CapstonePrize {
  label: string;
  emoji: string;
  status: 'decided' | 'pending';
  winner?: TeamRef;
}

/** A ranked prize (best group-2 side, wooden shrew) with current leaders + standings. */
export interface RankedPrize {
  label: string;
  emoji: string;
  status: 'decided' | 'leading';
  leaders: TeamRef[];
  standings: TeamRef[];
}

export interface Prizes {
  first: CapstonePrize;
  second: CapstonePrize;
  third: RankedPrize;
  fourth: RankedPrize;
}

export interface Meta {
  updatedAt: string;
  idCompetition: string;
  idSeason: string;
  totalMatches: number;
  playedMatches: number;
  groupComplete: boolean;
  tournamentOver: boolean;
  source: string;
}

/** A sweepstake participant and the teams they own. */
export interface Person {
  name: string;
  /**
   * The teams this player owns. Tiered-pair leagues list two (strong then
   * weak); full-group leagues list a whole FIFA group's sides.
   */
  teams: TeamRef[];
  status: PrizeStatus;
}

/** The complete payload served as data/results.json. */
export interface Results {
  meta: Meta;
  prizes: Prizes;
  fixtures: Fixture[];
  knockout: Fixture[];
  leagueTable: LeagueRow[];
  teams: TeamRef[];
  people: Person[];
}
