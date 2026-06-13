// Client-side dashboard. Seeds from baked JSON for instant paint, then re-fetches
// the live results.json from the CDN so data updates never need a site rebuild.

import type {
  Fixture,
  Person,
  PrizeKey,
  PrizeStatus,
  Results,
  Status,
  TeamRef,
  Tier,
} from '../types';
import type { LeagueConfig, PrizeDef } from '../leagues';

// Active league config + its prize set. Baked into the page as
// <script id="league"> and assigned by init() before any render runs.
let league!: LeagueConfig;
let prizes!: readonly PrizeDef[];

const STATUS_WORD: Record<Status, string> = {
  won: 'Won',
  lost: 'Out',
  ongoing: 'In play',
  na: 'N/A',
};

// Assigned by init() before any render runs; the `!` asserts that contract.
let data!: Results;
let view = 'prizes';
let subtab = 'winner';
let me: string | null = null;
let teamFilter = 'all';
let fixtureFilter = 'all';
let meTime = 'all'; // My-teams games: 'all' | 'upcoming'
let meTeam = 'both'; // My-teams games: 'both' | a team's fifaId

// ---------- helpers ----------
function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
}
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string | number | null | undefined): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c] ?? c);
const flag = (iso2: string): string => `https://flagcdn.com/${iso2}.svg`;

function flagImg(team: TeamRef | null, cls = 'h-4 w-6'): string {
  if (!team) return '';
  return `<img src="${flag(team.iso2)}" alt="" loading="lazy" class="${cls} rounded-sm object-cover ring-1 ring-black/10 dark:ring-white/10" />`;
}

function ringFor(status: Status): string {
  return status === 'won'
    ? 'ring-emerald-500'
    : status === 'lost'
      ? 'ring-rose-500'
      : status === 'na'
        ? 'ring-slate-200 dark:ring-slate-700 opacity-40'
        : 'ring-slate-300 dark:ring-slate-600';
}

// Row of the four prize emojis, ringed by status. Used on player + team cards.
function prizeChips(st: PrizeStatus): string {
  return `<div class="flex gap-1.5">${prizes
    .map((p) => {
      const status = st[p.key];
      return `<span title="${p.label}: ${STATUS_WORD[status]}" class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-lg ring-2 ${ringFor(status)} dark:bg-slate-800">${p.emoji}</span>`;
    })
    .join('')}</div>`;
}

function tierBadge(tier: Tier | null): string {
  if (tier == null) return '';
  return tier === 1
    ? '<span class="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">GROUP 1</span>'
    : '<span class="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-400">GROUP 2</span>';
}

function statusPill(status: Status): string {
  const map: Record<Status, string> = {
    won: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    lost: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    ongoing: 'bg-slate-400/15 text-slate-600 dark:text-slate-300',
    na: 'bg-slate-400/10 text-slate-400',
  };
  return `<span class="rounded-full px-2 py-0.5 text-xs font-bold ${map[status]}">${STATUS_WORD[status]}</span>`;
}

// ---------- banner (top of each prize tab) ----------
function banner(emoji: string, title: string, sub: string, decided: boolean): string {
  const tone = decided
    ? 'from-amber-400 to-orange-500 text-white'
    : 'from-slate-100 to-slate-200 text-slate-800 dark:from-slate-800 dark:to-slate-700 dark:text-slate-100';
  return `<div class="mb-4 rounded-2xl bg-gradient-to-r ${tone} p-4 shadow-sm animate-pop">
    <div class="flex items-center gap-3">
      <span class="text-4xl">${emoji}</span>
      <div class="min-w-0">
        <div class="text-xs font-bold uppercase tracking-wide opacity-80">${esc(title)}</div>
        <div class="truncate text-lg font-extrabold">${sub}</div>
      </div>
    </div>
  </div>`;
}

function ownerOf(t: TeamRef | undefined): string {
  return t ? `<span class="opacity-70">${esc(t.owner)}</span>` : '';
}

function prizeBanner(): string {
  if (subtab === 'winner') {
    const w = data.prizes.first.winner;
    return w
      ? banner('🏆', 'Winner · £120', `${esc(w.name)} — ${ownerOf(w)}`, true)
      : banner('🏆', 'Winner · £120', 'Still up for grabs', false);
  }
  if (subtab === 'third') {
    const w = data.prizes.second.winner;
    return w
      ? banner('🥉', '3rd place · £40', `${esc(w.name)} — ${ownerOf(w)}`, true)
      : banner('🥉', '3rd place · £40', 'Decided after the 3rd-place play-off', false);
  }
  if (subtab === 'bestGroup2') {
    const p = data.prizes.third;
    const names = p.leaders.map((t) => `${esc(t.name)} (${esc(t.owner)})`).join(', ');
    return banner(
      '🪖',
      'Best group-2 side · £40',
      p.status === 'decided' ? `${names} — winner!` : `Leading: ${names || '—'}`,
      p.status === 'decided',
    );
  }
  // shrew
  const p = data.prizes.fourth;
  const names = p.leaders.map((t) => `${esc(t.name)} (${esc(t.owner)})`).join(', ');
  return banner(
    '🪵',
    'Wooden shrew · £40',
    p.status === 'decided' ? names : `Currently worst: ${names || '—'}`,
    p.status === 'decided',
  );
}

// ---------- bracket (winner / third / best-group-2 tabs) ----------
function bracketRow(
  team: TeamRef | null,
  ph: string | null,
  score: number | null,
  pen: number | null,
  win: boolean,
  dim: boolean,
): string {
  if (!team) {
    return `<div class="flex items-center gap-2 px-2.5 py-2"><span class="text-xs italic text-slate-400">${esc(ph || 'TBD')}</span></div>`;
  }
  const bold = win ? 'font-extrabold' : 'font-medium';
  return `<div class="flex items-center gap-2 px-2.5 py-2 ${dim ? 'opacity-25' : ''} ${win ? 'bg-amber-400/15' : ''}">
    ${flagImg(team, 'h-4 w-6')}
    <span class="min-w-0 flex-1 truncate text-sm ${bold}">${esc(team.name)}<span class="ml-1 text-[10px] font-normal text-slate-400">${esc(team.owner)}</span></span>
    ${win ? '<span class="text-amber-500">▸</span>' : ''}
    <span class="w-4 text-right text-sm tabular-nums ${bold}">${score ?? '–'}</span>
    ${pen != null ? `<span class="text-[10px] text-slate-400">(${pen})</span>` : ''}
  </div>`;
}

function matchCard(m: Fixture, highlightTier2: boolean): string {
  const hw = !!(m.winnerId && m.winnerId === m.home?.fifaId);
  const aw = !!(m.winnerId && m.winnerId === m.away?.fifaId);
  const dim = (t: TeamRef | null): boolean => highlightTier2 && t != null && t.tier !== 2;
  return `<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
    ${bracketRow(m.home, m.homePlaceholder, m.homeScore, m.homePen, hw, dim(m.home))}
    <div class="h-px bg-slate-100 dark:bg-slate-700/70"></div>
    ${bracketRow(m.away, m.awayPlaceholder, m.awayScore, m.awayPen, aw, dim(m.away))}
  </div>`;
}

function capstoneCard(kind: 'winner' | 'third'): string {
  const p = kind === 'winner' ? data.prizes.first : data.prizes.second;
  const w = p.winner;
  const emoji = kind === 'winner' ? '🏆' : '🥉';
  const title = kind === 'winner' ? 'Champions' : '3rd place';
  const inner = w
    ? `<div class="mt-2 flex items-center justify-center gap-2">${flagImg(w, 'h-5 w-7')}<span class="text-lg font-extrabold">${esc(w.name)}</span></div>
       <div class="text-xs font-medium opacity-90">${esc(w.owner)}</div>`
    : '<div class="mt-2 text-base font-bold opacity-90">To be decided</div>';
  return `<div class="flex shrink-0 flex-col justify-center">
    <div class="w-44 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 p-4 text-center text-white shadow-lg">
      <div class="text-5xl leading-none">${emoji}</div>
      <div class="mt-1 text-[11px] font-bold uppercase tracking-wide opacity-90">${title}</div>
      ${inner}
    </div>
  </div>`;
}

function renderBracket(highlightTier2 = false, capstone: 'winner' | 'third' | null = null): string {
  const byDepth: Record<number, Fixture[]> = {};
  for (const m of data.knockout) (byDepth[m.depth] ??= []).push(m);
  const cols = [1, 2, 3, 4, 5, 6].filter((d) => byDepth[d]);
  const note = highlightTier2
    ? '<p class="mb-3 text-sm text-slate-500 dark:text-slate-400">Group-2 sides highlighted; the prize goes to whichever gets furthest (then most goals).</p>'
    : '';
  const columns = cols
    .map((d) => {
      const ms = byDepth[d] ?? [];
      return `
    <div class="flex w-52 shrink-0 flex-col sm:w-56">
      <div class="mb-2 text-center">
        <span class="rounded-full bg-slate-200 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-200">${esc(ms[0]?.stage ?? '')}</span>
      </div>
      <div class="flex flex-1 flex-col justify-center gap-2.5">${ms.map((m) => matchCard(m, highlightTier2)).join('')}</div>
    </div>`;
    })
    .join('');
  const cap = capstone ? capstoneCard(capstone) : '';
  return `${note}<div class="flex items-stretch gap-3 overflow-x-auto no-scrollbar pb-2">${columns}${cap}</div>`;
}

// ---------- wooden-shrew league table ----------
function renderShrew(): string {
  const decided = data.meta.groupComplete;
  const rows = decided ? data.leagueTable.filter((t) => !t.qualified) : data.leagueTable;
  const leaderIds = new Set(data.prizes.fourth.leaders.map((t) => t.fifaId));
  const heading = decided
    ? `The ${rows.length} sides that didn't reach the knockouts — worst first`
    : 'Combined table — worst first (the bottom 16 miss out on the knockouts)';
  const body = rows
    .map((t) => {
      const isShrew = leaderIds.has(t.fifaId);
      const hl = isShrew ? 'bg-rose-500/10 ring-1 ring-rose-400/40' : '';
      return `<tr class="${hl}">
      <td class="px-2 py-2 text-center text-sm font-bold tabular-nums text-slate-400">${t.rank}</td>
      <td class="px-2 py-2">
        <div class="flex items-center gap-2">
          ${flagImg(t)}
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold">${esc(t.name)}${isShrew ? ' 🪵' : ''}</div>
            <div class="truncate text-[11px] text-slate-400">${esc(t.owner)}</div>
          </div>
        </div>
      </td>
      <td class="px-2 py-2 text-center text-sm tabular-nums">${t.w + t.d + t.l}</td>
      <td class="px-2 py-2 text-center text-sm tabular-nums">${t.gd > 0 ? '+' : ''}${t.gd}</td>
      <td class="px-2 py-2 text-center text-sm font-bold tabular-nums">${t.pts}</td>
    </tr>`;
    })
    .join('');
  return `<p class="mb-3 text-sm text-slate-500 dark:text-slate-400">${heading}</p>
  <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
    <table class="w-full">
      <thead class="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400 dark:bg-slate-900/40">
        <tr><th class="px-2 py-2">#</th><th class="px-2 py-2 text-left">Team</th><th class="px-2 py-2">P</th><th class="px-2 py-2">GD</th><th class="px-2 py-2">Pts</th></tr>
      </thead>
      <tbody class="divide-y divide-slate-100 dark:divide-slate-700/60">${body}</tbody>
    </table>
  </div>`;
}

function renderPrizes(): void {
  $('#prize-banner').innerHTML = prizeBanner();
  $('#prize-body').innerHTML =
    subtab === 'shrew'
      ? renderShrew()
      : subtab === 'bestGroup2'
        ? renderBracket(true, null)
        : renderBracket(false, subtab === 'third' ? 'third' : 'winner');
  document.querySelectorAll<HTMLElement>('[data-subtab]').forEach((b) => {
    const active = b.dataset['subtab'] === subtab;
    b.className = `flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
      active
        ? 'border-amber-500 bg-amber-500 text-white shadow'
        : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
    }`;
  });
}

// ---------- My teams ----------
const RANK: Record<Status, number> = { won: 3, ongoing: 2, lost: 1, na: 0 };
function bestTeam(teams: TeamRef[], key: PrizeKey): TeamRef | undefined {
  const cands = teams.filter((t) => t.status[key] !== 'na');
  return cands.sort((a, b) => RANK[b.status[key]] - RANK[a.status[key]])[0];
}

function myPrizeLine(p: Person, key: PrizeKey, status: Status): string {
  if (key === 'bestGroup2') {
    const g2 = p.teams.find((t) => t.status.bestGroup2 !== 'na');
    if (!g2) return '';
    if (status === 'won') return `${esc(g2.name)} is the best group-2 side!`;
    if (status === 'ongoing') {
      return data.prizes.third.leaders.some((x) => x.fifaId === g2.fifaId)
        ? `${esc(g2.name)} is currently leading`
        : `${esc(g2.name)} still in contention`;
    }
    return `${esc(g2.name)} can't win this one`;
  }
  const t = bestTeam(p.teams, key);
  const name = esc(t?.name);
  if (key === 'winner') {
    if (status === 'won') return `${name} are world champions! 🎉`;
    if (status === 'ongoing') return `Still alive — ${name} in the ${esc(t?.furthestLabel)}`;
    return 'All your teams are out';
  }
  if (key === 'third') {
    if (status === 'won') return `${name} finished 3rd!`;
    if (status === 'ongoing') return `Still possible via ${name}`;
    return 'No longer possible';
  }
  // shrew
  if (status === 'won') return `${name} is the wooden shrew 🪵`;
  if (status === 'ongoing') return 'Not decided until the group stage ends';
  return 'Safe from the shrew';
}

function teamCardBig(t: TeamRef): string {
  const state = t.champion
    ? 'World champions 🏆'
    : t.eliminated
      ? 'Eliminated'
      : `In the ${t.furthestLabel}`;
  return `<div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
    ${flagImg(t, 'h-10 w-14')}
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2"><span class="truncate font-bold">${esc(t.name)}</span>${tierBadge(t.tier)}</div>
      <div class="text-xs text-slate-500 dark:text-slate-400">${t.group ? 'Group ' + esc(t.group) + ' · ' : ''}${esc(state)}</div>
    </div>
    <div class="text-right text-sm tabular-nums text-slate-500 dark:text-slate-400">
      <div>${t.pts} pts</div><div class="text-xs">${t.gf}-${t.ga}</div>
    </div>
  </div>`;
}

function renderMe(): void {
  const p = data.people.find((x) => x.name === me) ?? data.people[0];
  if (!p) return;
  me = p.name;
  // keep the games team-filter valid when the selected player changes
  if (meTeam !== 'both' && !p.teams.some((t) => t.fifaId === meTeam)) meTeam = 'both';
  const wins = prizes.filter((pr) => p.status[pr.key] === 'won');
  const header = wins.length
    ? `<div class="mb-4 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 p-4 text-white shadow animate-pop">
        <div class="text-sm font-bold uppercase tracking-wide opacity-90">You're winning</div>
        <div class="text-2xl font-extrabold">${wins.map((w) => w.emoji).join(' ')} ${wins.map((w) => w.label).join(' + ')}</div>
       </div>`
    : '';
  const prizeList = prizes
    .map((pr) => {
      const status = p.status[pr.key];
      return `<div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-2xl ring-2 ${ringFor(status)} dark:bg-slate-900">${pr.emoji}</span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2"><span class="font-bold">${pr.label}</span><span class="text-xs text-slate-400">${pr.amount}</span></div>
        <div class="truncate text-sm text-slate-500 dark:text-slate-400">${myPrizeLine(p, pr.key, status)}</div>
      </div>
      ${statusPill(status)}
    </div>`;
    })
    .join('');
  $('#me-body').innerHTML = `${header}
    <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">${p.teams.map(teamCardBig).join('')}</div>
    <div class="mb-6 space-y-2">${prizeList}</div>
    <div id="me-fixtures"></div>`;
  renderMeFixtures();
}

// ---------- My teams · games ----------
function renderMeFixtures(): void {
  const p = data.people.find((x) => x.name === me) ?? data.people[0];
  if (!p) return;
  const idSet = new Set(meTeam === 'both' ? p.teams.map((t) => t.fifaId) : [meTeam]);
  const list = data.fixtures.filter((f) => {
    const involved =
      (f.home != null && idSet.has(f.home.fifaId)) || (f.away != null && idSet.has(f.away.fifaId));
    return involved && !(meTime === 'upcoming' && f.played);
  });

  const pill = (active: boolean): string =>
    `shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
      active
        ? 'border-amber-500 bg-amber-500 text-white shadow'
        : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
    }`;
  const timeRow = [
    { key: 'all', label: 'All games' },
    { key: 'upcoming', label: 'Upcoming' },
  ]
    .map(
      (b) => `<button data-metime="${b.key}" class="${pill(meTime === b.key)}">${b.label}</button>`,
    )
    .join('');
  const teamRow = [
    { key: 'both', label: 'All teams' },
    ...p.teams.map((t) => ({ key: t.fifaId, label: t.name })),
  ]
    .map(
      (b) =>
        `<button data-meteam="${esc(b.key)}" class="${pill(meTeam === b.key)}">${esc(b.label)}</button>`,
    )
    .join('');

  const body = list.length
    ? daysHtml(groupByDay(list), null)
    : `<p class="rounded-2xl border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">No ${meTime === 'upcoming' ? 'upcoming ' : ''}games to show.</p>`;

  $('#me-fixtures').innerHTML = `
    <h2 class="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Games</h2>
    <div class="mb-2 flex gap-2 overflow-x-auto no-scrollbar">${timeRow}</div>
    <div class="mb-4 flex gap-2 overflow-x-auto no-scrollbar">${teamRow}</div>
    ${body}`;

  $('#me-fixtures')
    .querySelectorAll<HTMLElement>('[data-metime]')
    .forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.dataset['metime'];
        if (v) {
          meTime = v;
          renderMeFixtures();
        }
      });
    });
  $('#me-fixtures')
    .querySelectorAll<HTMLElement>('[data-meteam]')
    .forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.dataset['meteam'];
        if (v) {
          meTeam = v;
          renderMeFixtures();
        }
      });
    });
}

// ---------- Players grid ----------
function miniTeam(t: TeamRef): string {
  return `<div class="flex items-center gap-1.5 text-xs"><span>${flagImg(t, 'h-3.5 w-5')}</span><span class="truncate">${esc(t.name)}</span></div>`;
}
function renderPlayers(): void {
  $('#players-body').innerHTML = data.people
    .map(
      (p) => `
    <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div class="mb-2 font-bold">${esc(p.name)}</div>
      <div class="mb-3 grid grid-cols-2 gap-1">${p.teams.map(miniTeam).join('')}</div>
      ${prizeChips(p.status)}
    </div>`,
    )
    .join('');
}

// ---------- Teams grid ----------
function renderTeams(): void {
  const filters = [
    { key: 'all', label: 'All' },
    { key: '1', label: 'Group 1' },
    { key: '2', label: 'Group 2' },
  ];
  $('#teams-filter').innerHTML = filters
    .map((f) => {
      const active = teamFilter === f.key;
      return `<button data-teamfilter="${f.key}" class="shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
        active
          ? 'border-amber-500 bg-amber-500 text-white shadow'
          : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
      }">${f.label}</button>`;
    })
    .join('');
  const list = data.teams.filter((t) => teamFilter === 'all' || String(t.tier) === teamFilter);
  $('#teams-body').innerHTML = list
    .map(
      (t) => `
    <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div class="mb-2 flex items-center gap-2">
        ${flagImg(t, 'h-7 w-10')}
        <div class="min-w-0 flex-1">
          <div class="truncate font-bold">${esc(t.name)}</div>
          <div class="truncate text-[11px] text-slate-400">${esc(t.owner)}</div>
        </div>
        ${tierBadge(t.tier)}
      </div>
      <div class="mb-3 text-xs text-slate-500 dark:text-slate-400">${t.group ? 'Group ' + esc(t.group) + ' · ' : ''}${t.champion ? 'World champions 🏆' : t.eliminated ? `out in ${esc(t.furthestLabel)}` : `In the ${esc(t.furthestLabel)}`}</div>
      ${prizeChips(t.status)}
    </div>`,
    )
    .join('');
  document.querySelectorAll<HTMLElement>('[data-teamfilter]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset['teamfilter'];
      if (v) {
        teamFilter = v;
        renderTeams();
      }
    });
  });
}

// ---------- Fixtures (schedule) ----------
const LONDON = 'Europe/London';
const dayLabel = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: LONDON,
      })
    : 'TBD';
const timeLabel = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: LONDON,
      })
    : '';

function fixtureSide(team: TeamRef | null, ph: string | null, side: 'home' | 'away'): string {
  if (!team)
    return `<div class="text-xs italic text-slate-400 ${side === 'home' ? 'text-right' : ''}">${esc(ph || 'TBD')}</div>`;
  const order = side === 'home' ? 'flex-row-reverse text-right' : '';
  return `<div class="flex min-w-0 items-center gap-2 ${order}">
    ${flagImg(team, 'h-6 w-8')}
    <div class="min-w-0">
      <div class="truncate text-sm font-semibold">${esc(team.name)}</div>
      <div class="truncate text-[11px] text-slate-400">${esc(team.owner)}</div>
    </div>
  </div>`;
}

function fixtureCentre(f: Fixture): string {
  if (f.live) {
    return `<div class="px-2 text-center">
      <div class="text-lg font-extrabold tabular-nums">${f.homeScore ?? 0}–${f.awayScore ?? 0}</div>
      <div class="flex items-center justify-center gap-1 text-[10px] font-bold text-rose-500">
        <span class="inline-block h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse"></span>LIVE${f.matchTime ? ' ' + esc(f.matchTime) : ''}
      </div>
    </div>`;
  }
  if (f.played) {
    const note =
      f.homePen != null && f.awayPen != null
        ? `<div class="text-[10px] text-slate-400">pens ${f.homePen}–${f.awayPen}</div>`
        : f.result
          ? `<div class="text-[10px] text-slate-400">${esc(f.result)}</div>`
          : '';
    return `<div class="px-2 text-center"><div class="text-lg font-extrabold tabular-nums">${f.homeScore ?? 0}–${f.awayScore ?? 0}</div>${note}</div>`;
  }
  return `<div class="px-2 text-center"><div class="text-sm font-bold tabular-nums text-slate-500 dark:text-slate-400">${timeLabel(f.date)}</div><div class="text-[10px] text-slate-400">BST</div></div>`;
}

// A single fixture card. `isFocus` marks the game we scroll to (live game, else next up);
// a live game always gets the rose ring + LIVE label regardless of focus.
function fixtureCard(f: Fixture, isFocus = false): string {
  const attrs = isFocus ? ' id="focus-fixture" style="scroll-margin-top:5.5rem"' : '';
  const ring = f.live ? ' ring-2 ring-rose-500' : isFocus ? ' ring-2 ring-amber-400' : '';
  const venue = f.venue?.name
    ? `<div class="mt-1.5 text-center text-[10px] text-slate-400">${esc(f.venue.name)}${f.venue.city ? ' · ' + esc(f.venue.city) : ''}</div>`
    : '';
  return `<div${attrs} class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800${ring}">
    <div class="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-400">
      <span>${f.date ? timeLabel(f.date) + ' BST' : ''}</span>
      <span class="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-700/60">${esc(f.group ? 'Group ' + f.group : f.stage)}</span>
    </div>
    <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
      ${fixtureSide(f.home, f.homePlaceholder, 'home')}
      ${fixtureCentre(f)}
      ${fixtureSide(f.away, f.awayPlaceholder, 'away')}
    </div>
    ${venue}
  </div>`;
}

// Group an ordered fixture list into London-day buckets, preserving chronological order.
function groupByDay(list: Fixture[]): { key: string; items: Fixture[] }[] {
  const days: { key: string; items: Fixture[] }[] = [];
  for (const f of list) {
    const key = dayLabel(f.date);
    let bucket = days[days.length - 1];
    if (bucket?.key !== key) {
      bucket = { key, items: [] };
      days.push(bucket);
    }
    bucket.items.push(f);
  }
  return days;
}

// Render day-grouped fixtures; the card whose matchId === focusId gets the focus treatment.
function daysHtml(days: { key: string; items: Fixture[] }[], focusId: string | null): string {
  return days
    .map(
      (day) => `
    <div class="mb-5">
      <h3 class="sticky top-[57px] z-10 mb-2 bg-slate-100/90 py-1 text-sm font-bold text-slate-500 backdrop-blur dark:bg-slate-950/90 dark:text-slate-400">${esc(day.key)}</h3>
      <div class="space-y-2">${day.items.map((f) => fixtureCard(f, f.matchId === focusId)).join('')}</div>
    </div>`,
    )
    .join('');
}

// The fixture to focus/scroll to: a live game if one is in progress, otherwise the next
// unplayed game (the schedule is already in chronological order).
function focusFixtureId(): string | null {
  const f = data.fixtures.find((x) => x.live) ?? data.fixtures.find((x) => !x.played);
  return f ? f.matchId : null;
}

function renderFixtures(): void {
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'group', label: 'Group stage' },
    { key: 'ko', label: 'Knockouts' },
  ];
  $('#fixtures-filter').innerHTML = filters
    .map((f) => {
      const active = fixtureFilter === f.key;
      return `<button data-fixfilter="${f.key}" class="shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
        active
          ? 'border-amber-500 bg-amber-500 text-white shadow'
          : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
      }">${f.label}</button>`;
    })
    .join('');

  const list = data.fixtures.filter(
    (f) => fixtureFilter === 'all' || (fixtureFilter === 'group' ? f.depth === 0 : f.depth >= 1),
  );

  $('#fixtures-body').innerHTML = daysHtml(groupByDay(list), focusFixtureId());

  // Button reflects whether there's a game on right now.
  const jump = document.getElementById('jump-next');
  if (jump) jump.textContent = data.fixtures.some((f) => f.live) ? '🔴 Live now' : '⏭️ Next game';

  document.querySelectorAll<HTMLElement>('[data-fixfilter]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset['fixfilter'];
      if (v) {
        fixtureFilter = v;
        renderFixtures();
      }
    });
  });
}

// ---------- view orchestration ----------
function renderCurrent(): void {
  if (view === 'prizes') renderPrizes();
  else if (view === 'fixtures') renderFixtures();
  else if (view === 'me') renderMe();
  else if (view === 'players') renderPlayers();
  else if (view === 'teams') renderTeams();
}

function showView(v: string): void {
  view = v;
  document
    .querySelectorAll<HTMLElement>('[data-section]')
    .forEach((s) => s.classList.toggle('is-active', s.dataset['section'] === v));
  // Desktop top tabs: active = filled amber pill (matches the sub-tabs/filters).
  document.querySelectorAll<HTMLElement>('[data-navbar="top"] [data-nav]').forEach((b) => {
    const active = b.dataset['nav'] === v;
    b.className = `rounded-full px-3 py-1.5 text-sm font-semibold transition ${
      active
        ? 'bg-amber-500 text-white shadow'
        : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
    }`;
  });
  // Mobile bottom bar: active = amber pill behind the icon + amber bold label.
  document.querySelectorAll<HTMLElement>('[data-navbar="bottom"] [data-nav]').forEach((b) => {
    const active = b.dataset['nav'] === v;
    const pill = b.querySelector<HTMLElement>('[data-navpill]');
    const label = b.querySelector<HTMLElement>('[data-navlabel]');
    if (pill) {
      pill.className = `flex h-8 w-14 items-center justify-center rounded-full text-xl leading-none transition ${
        active ? 'bg-amber-500/20 dark:bg-amber-400/20' : ''
      }`;
    }
    if (label) {
      label.className = `text-[11px] font-semibold transition ${
        active ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
      }`;
    }
  });
  if (location.hash.slice(1) !== v) history.replaceState(null, '', `#${v}`);
  renderCurrent();
}

// Bring the focus game (live, else next up) to the top of the screen (button + fresh-load).
function jumpToFocus(smooth: boolean): void {
  if (fixtureFilter !== 'all') {
    fixtureFilter = 'all';
    renderFixtures();
  }
  const el = document.getElementById('focus-fixture');
  if (el) el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

function applyData(d: Results): void {
  data = d;
  // populate player selector once
  const sel = document.querySelector<HTMLSelectElement>('#me-select');
  if (sel && !sel.options.length) {
    sel.innerHTML = data.people
      .map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`)
      .join('');
    const fromUrl = new URLSearchParams(location.search).get('me');
    const stored = localStorage.getItem(`${league.slug}:me`);
    const fallback = data.people[0]?.name ?? '';
    me = [fromUrl, stored].find((n) => n && data.people.some((p) => p.name === n)) ?? fallback;
    sel.value = me;
    sel.addEventListener('change', () => {
      me = sel.value;
      localStorage.setItem(`${league.slug}:me`, me);
      const url = new URL(location.href);
      url.searchParams.set('me', me);
      history.replaceState(null, '', url);
      renderMe();
    });
  }
  const u = data.meta.updatedAt ? new Date(data.meta.updatedAt).toLocaleString() : '—';
  $('#updated').textContent =
    `${data.meta.playedMatches}/${data.meta.totalMatches} matches played · updated ${u}`;
  renderCurrent();
}

export function init(): void {
  data = JSON.parse($('#seed').textContent || '{}') as Results;
  league = JSON.parse(document.getElementById('league')?.textContent || '{}') as LeagueConfig;
  prizes = league.prizes;
  if (league.slug) localStorage.setItem('league:last', league.slug);

  // nav + subtab wiring
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset['nav'];
      if (v) showView(v);
    });
  });
  const wantTab = new URLSearchParams(location.search).get('prize');
  if (wantTab && prizes.some((p) => p.key === wantTab)) subtab = wantTab;
  document.querySelectorAll<HTMLElement>('[data-subtab]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset['subtab'];
      if (!v) return;
      subtab = v;
      const url = new URL(location.href);
      url.searchParams.set('prize', subtab);
      history.replaceState(null, '', url);
      renderPrizes();
    });
  });

  applyData(data);

  // View: honour the URL hash; a fresh browser (no hash) lands on Fixtures at the next game.
  const hashView = location.hash.slice(1);
  const validView = ['prizes', 'fixtures', 'me', 'players', 'teams'].includes(hashView);
  showView(validView ? hashView : 'fixtures');
  document.getElementById('jump-next')?.addEventListener('click', () => {
    jumpToFocus(true);
  });
  if (!validView)
    requestAnimationFrame(() => {
      jumpToFocus(false);
    });

  // In production, pull fresh data and re-render if it changed. In dev we keep the
  // baked seed so `yarn snapshot <name>` previews work without the CDN overriding them.
  if (import.meta.env.PROD) {
    void (async () => {
      try {
        const r = await fetch(`${league.resultsUrl}?t=${Date.now().toString()}`);
        if (!r.ok) return;
        const fresh = (await r.json()) as Results;
        if (fresh.meta.updatedAt !== data.meta.updatedAt) applyData(fresh);
      } catch {
        // Ignore network/JSON errors; the baked seed stays on screen.
      }
    })();
  }
}
