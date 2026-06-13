// Multi-league registry. Each league is one sweepstake overlaid on the *same*
// World Cup tournament: identical match data, different ownership + prize set.
// This config drives the routing (`[league].astro`), the picker (`index.astro`)
// and the client dashboard (`scripts/app.ts` reads the active league's config
// from the baked `<script id="league">` JSON).

import type { PrizeKey } from './types';

/** How a player's teams are assigned in a league. */
export type OwnershipMode =
  | 'tiered-pair' // each player owns one strong (group1) + one weak (group2) team
  | 'full-group'; // each player owns a whole FIFA group (A–L), i.e. ~4 teams

/**
 * One prize as shown in the UI. `slot` is the positional key under
 * `Results.prizes` that backs this prize (the data shape is positional;
 * the prize *key* is its stable identity).
 */
export interface PrizeDef {
  key: PrizeKey;
  slot: 'first' | 'second' | 'third' | 'fourth';
  emoji: string;
  label: string;
  amount: string;
}

/** Everything that varies between two sweepstakes on the same tournament. */
export interface LeagueConfig {
  slug: string;
  name: string;
  tagline: string;
  /** Two emojis flanking the league name in the header. */
  headerEmojis: [string, string];
  themeColor: string;
  ownershipMode: OwnershipMode;
  /** CDN URL the client re-fetches at runtime for live data. */
  resultsUrl: string;
  /** Ordered prize set; the prize sub-tabs derive from this. */
  prizes: PrizeDef[];
}

const RAW_BASE =
  'https://raw.githubusercontent.com/dnelson17/wc26-golden-shrew-sweepstakes/main/data';

export const LEAGUES: Record<string, LeagueConfig> = {
  'golden-shrew': {
    slug: 'golden-shrew',
    name: 'Golden Shrew',
    tagline: '2026 World Cup sweepstake',
    headerEmojis: ['🪵', '🏆'],
    themeColor: '#f59e0b',
    ownershipMode: 'tiered-pair',
    resultsUrl: `${RAW_BASE}/results.json`,
    prizes: [
      { key: 'winner', slot: 'first', emoji: '🏆', label: 'Winner', amount: '£120' },
      { key: 'third', slot: 'second', emoji: '🥉', label: '3rd place', amount: '£40' },
      { key: 'bestGroup2', slot: 'third', emoji: '🪖', label: 'Best group-2', amount: '£40' },
      { key: 'shrew', slot: 'fourth', emoji: '🪵', label: 'Wooden shrew', amount: '£40' },
    ],
  },
  // 12-person draw (£10 each → £120 pot): each player owns a whole FIFA group
  // (A–L). No tiered teams, so there's no "best group-2" prize — three prizes.
  nelson: {
    slug: 'nelson',
    name: 'Nelson Sweepstake',
    tagline: '2026 World Cup sweepstake',
    headerEmojis: ['🪵', '🏆'],
    themeColor: '#f59e0b',
    ownershipMode: 'full-group',
    resultsUrl: `${RAW_BASE}/results.nelson.json`,
    prizes: [
      { key: 'winner', slot: 'first', emoji: '🏆', label: 'Winner', amount: '£80' },
      { key: 'third', slot: 'second', emoji: '🥉', label: '3rd place', amount: '£20' },
      { key: 'shrew', slot: 'fourth', emoji: '🪵', label: 'Wooden shrew', amount: '£20' },
    ],
  },
};

/** League the picker redirect / bare links fall back to. */
export const DEFAULT_LEAGUE = 'golden-shrew';

export const leagueList = (): LeagueConfig[] => Object.values(LEAGUES);
