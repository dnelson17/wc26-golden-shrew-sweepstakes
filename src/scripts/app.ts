// Client-side dashboard. Seeds from baked JSON for instant paint, then re-fetches
// the live results.json from the CDN so data updates never need a site rebuild.

const RESULTS_URL =
  'https://raw.githubusercontent.com/dnelson17/wc26-golden-shrew-sweepstakes/main/data/results.json';

type Status = 'won' | 'lost' | 'ongoing' | 'na';

const PRIZES = [
  { key: 'winner', emoji: '🏆', label: 'Winner', amount: '£120' },
  { key: 'third', emoji: '🥉', label: '3rd place', amount: '£40' },
  { key: 'bestGroup2', emoji: '🪖', label: 'Best group-2', amount: '£40' },
  { key: 'shrew', emoji: '🪵', label: 'Wooden shrew', amount: '£40' },
] as const;

const STATUS_WORD: Record<Status, string> = { won: 'Won', lost: 'Out', ongoing: 'In play', na: 'N/A' };

let data: any = null;
let view = 'prizes';
let subtab = 'winner';
let me: string | null = null;
let teamFilter = 'all';
let fixtureFilter = 'all';

// ---------- helpers ----------
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const flag = (iso2: string) => `https://flagcdn.com/${iso2}.svg`;

function flagImg(team: any, cls = 'h-4 w-6') {
  if (!team) return '';
  return `<img src="${flag(team.iso2)}" alt="" loading="lazy" class="${cls} rounded-sm object-cover ring-1 ring-black/10 dark:ring-white/10" />`;
}

function ringFor(status: Status) {
  return status === 'won' ? 'ring-emerald-500'
    : status === 'lost' ? 'ring-rose-500'
    : status === 'na' ? 'ring-slate-200 dark:ring-slate-700 opacity-40'
    : 'ring-slate-300 dark:ring-slate-600';
}

// Row of the four prize emojis, ringed by status. Used on player + team cards.
function prizeChips(st: Record<string, Status>) {
  return `<div class="flex gap-1.5">${PRIZES.map((p) => {
    const status = (st[p.key] ?? 'ongoing') as Status;
    return `<span title="${p.label}: ${STATUS_WORD[status]}" class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-lg ring-2 ${ringFor(status)} dark:bg-slate-800">${p.emoji}</span>`;
  }).join('')}</div>`;
}

function tierBadge(tier: number) {
  return tier === 1
    ? '<span class="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">GROUP 1</span>'
    : '<span class="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-400">GROUP 2</span>';
}

function statusPill(status: Status) {
  const map: Record<Status, string> = {
    won: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    lost: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    ongoing: 'bg-slate-400/15 text-slate-600 dark:text-slate-300',
    na: 'bg-slate-400/10 text-slate-400',
  };
  return `<span class="rounded-full px-2 py-0.5 text-xs font-bold ${map[status]}">${STATUS_WORD[status]}</span>`;
}

// ---------- banner (top of each prize tab) ----------
function banner(emoji: string, title: string, sub: string, decided: boolean) {
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

function ownerOf(t: any) { return t ? `<span class="opacity-70">${esc(t.owner)}</span>` : ''; }

function prizeBanner() {
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
    const names = p.leaders.map((t: any) => `${esc(t.name)} (${esc(t.owner)})`).join(', ');
    return banner('🪖', 'Best group-2 side · £40',
      p.status === 'decided' ? `${names} — winner!` : `Leading: ${names || '—'}`, p.status === 'decided');
  }
  // shrew
  const p = data.prizes.fourth;
  const names = p.leaders.map((t: any) => `${esc(t.name)} (${esc(t.owner)})`).join(', ');
  return banner('🪵', 'Wooden shrew · £40',
    p.status === 'decided' ? `${names}` : `Currently worst: ${names || '—'}`, p.status === 'decided');
}

// ---------- bracket (winner / third / best-group-2 tabs) ----------
function bracketRow(team: any, ph: string, score: any, pen: any, win: boolean, dim: boolean) {
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

function matchCard(m: any, highlightTier2: boolean) {
  const hw = !!(m.winnerId && m.home && m.winnerId === m.home.fifaId);
  const aw = !!(m.winnerId && m.away && m.winnerId === m.away.fifaId);
  const dim = (t: any) => highlightTier2 && t && t.tier !== 2;
  return `<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
    ${bracketRow(m.home, m.homePlaceholder, m.homeScore, m.homePen, hw, dim(m.home))}
    <div class="h-px bg-slate-100 dark:bg-slate-700/70"></div>
    ${bracketRow(m.away, m.awayPlaceholder, m.awayScore, m.awayPen, aw, dim(m.away))}
  </div>`;
}

function capstoneCard(kind: 'winner' | 'third') {
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

function renderBracket(highlightTier2 = false, capstone: 'winner' | 'third' | null = null) {
  const byDepth: Record<number, any[]> = {};
  for (const m of data.knockout) (byDepth[m.depth] ??= []).push(m);
  const cols = [1, 2, 3, 4, 5, 6].filter((d) => byDepth[d]);
  const note = highlightTier2
    ? '<p class="mb-3 text-sm text-slate-500 dark:text-slate-400">Group-2 sides highlighted; the prize goes to whichever gets furthest (then most goals).</p>'
    : '';
  const columns = cols.map((d) => `
    <div class="flex w-52 shrink-0 flex-col sm:w-56">
      <div class="mb-2 text-center">
        <span class="rounded-full bg-slate-200 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-200">${esc(byDepth[d][0].stage)}</span>
      </div>
      <div class="flex flex-1 flex-col justify-center gap-2.5">${byDepth[d].map((m) => matchCard(m, highlightTier2)).join('')}</div>
    </div>`).join('');
  const cap = capstone ? capstoneCard(capstone) : '';
  return `${note}<div class="flex items-stretch gap-3 overflow-x-auto no-scrollbar pb-2">${columns}${cap}</div>`;
}

// ---------- wooden-shrew league table ----------
function renderShrew() {
  const decided = data.meta.groupComplete;
  const rows = decided ? data.leagueTable.filter((t: any) => !t.qualified) : data.leagueTable;
  const leaderIds = new Set(data.prizes.fourth.leaders.map((t: any) => t.fifaId));
  const heading = decided
    ? `The ${rows.length} sides that didn't reach the knockouts — worst first`
    : 'Combined table — worst first (the bottom 16 miss out on the knockouts)';
  const body = rows.map((t: any) => {
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
  }).join('');
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

function renderPrizes() {
  $('#prize-banner').innerHTML = prizeBanner();
  $('#prize-body').innerHTML =
    subtab === 'shrew' ? renderShrew()
    : subtab === 'bestGroup2' ? renderBracket(true, null)
    : renderBracket(false, subtab === 'third' ? 'third' : 'winner');
  document.querySelectorAll('[data-subtab]').forEach((b) => {
    const active = (b as HTMLElement).dataset.subtab === subtab;
    b.className = `flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
      active
        ? 'border-amber-500 bg-amber-500 text-white shadow'
        : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
    }`;
  });
}

// ---------- My teams ----------
const RANK: Record<Status, number> = { won: 3, ongoing: 2, lost: 1, na: 0 };
function bestTeam(g1: any, g2: any, key: string) {
  const cands = [g1, g2].filter((t) => t && t.status[key] !== 'na');
  return cands.sort((a, b) => RANK[b.status[key] as Status] - RANK[a.status[key] as Status])[0];
}

function myPrizeLine(p: any, key: string, status: Status): string {
  const t = bestTeam(p.group1, p.group2, key);
  if (key === 'winner') {
    if (status === 'won') return `${esc(t.name)} are world champions! 🎉`;
    if (status === 'ongoing') return `Still alive — ${esc(t.name)} in the ${esc(t.furthestLabel)}`;
    return 'Both your teams are out';
  }
  if (key === 'third') {
    if (status === 'won') return `${esc(t.name)} finished 3rd!`;
    if (status === 'ongoing') return `Still possible via ${esc(t.name)}`;
    return 'No longer possible';
  }
  if (key === 'bestGroup2') {
    const g2 = p.group2;
    if (status === 'won') return `${esc(g2.name)} is the best group-2 side!`;
    if (status === 'ongoing') return data.prizes.third.leaders.some((x: any) => x.fifaId === g2.fifaId)
      ? `${esc(g2.name)} is currently leading`
      : `${esc(g2.name)} still in contention`;
    return `${esc(g2.name)} can't win this one`;
  }
  // shrew
  if (status === 'won') return `${esc(t.name)} is the wooden shrew 🪵`;
  if (status === 'ongoing') return 'Not decided until the group stage ends';
  return 'Safe from the shrew';
}

function teamCardBig(t: any) {
  const state = t.champion ? 'World champions 🏆'
    : t.eliminated ? 'Eliminated'
    : `In the ${t.furthestLabel}`;
  return `<div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
    ${flagImg(t, 'h-10 w-14')}
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2"><span class="truncate font-bold">${esc(t.name)}</span>${tierBadge(t.tier)}</div>
      <div class="text-xs text-slate-500 dark:text-slate-400">${esc(state)}</div>
    </div>
    <div class="text-right text-sm tabular-nums text-slate-500 dark:text-slate-400">
      <div>${t.pts} pts</div><div class="text-xs">${t.gf}-${t.ga}</div>
    </div>
  </div>`;
}

function renderMe() {
  const p = data.people.find((x: any) => x.name === me) ?? data.people[0];
  me = p.name;
  const wins = PRIZES.filter((pr) => p.status[pr.key] === 'won');
  const header = wins.length
    ? `<div class="mb-4 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 p-4 text-white shadow animate-pop">
        <div class="text-sm font-bold uppercase tracking-wide opacity-90">You're winning</div>
        <div class="text-2xl font-extrabold">${wins.map((w) => w.emoji).join(' ')} ${wins.map((w) => w.label).join(' + ')}</div>
       </div>`
    : '';
  const prizeList = PRIZES.map((pr) => {
    const status = p.status[pr.key] as Status;
    return `<div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-2xl ring-2 ${ringFor(status)} dark:bg-slate-900">${pr.emoji}</span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2"><span class="font-bold">${pr.label}</span><span class="text-xs text-slate-400">${pr.amount}</span></div>
        <div class="truncate text-sm text-slate-500 dark:text-slate-400">${myPrizeLine(p, pr.key, status)}</div>
      </div>
      ${statusPill(status)}
    </div>`;
  }).join('');
  $('#me-body').innerHTML = `${header}
    <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">${teamCardBig(p.group1)}${teamCardBig(p.group2)}</div>
    <div class="space-y-2">${prizeList}</div>`;
}

// ---------- Players grid ----------
function miniTeam(t: any) {
  return `<div class="flex items-center gap-1.5 text-xs"><span>${flagImg(t, 'h-3.5 w-5')}</span><span class="truncate">${esc(t.name)}</span></div>`;
}
function renderPlayers() {
  $('#players-body').innerHTML = data.people.map((p: any) => `
    <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div class="mb-2 font-bold">${esc(p.name)}</div>
      <div class="mb-3 grid grid-cols-2 gap-1">${miniTeam(p.group1)}${miniTeam(p.group2)}</div>
      ${prizeChips(p.status)}
    </div>`).join('');
}

// ---------- Teams grid ----------
function renderTeams() {
  const filters = [
    { key: 'all', label: 'All' },
    { key: '1', label: 'Group 1' },
    { key: '2', label: 'Group 2' },
  ];
  $('#teams-filter').innerHTML = filters.map((f) => {
    const active = teamFilter === f.key;
    return `<button data-teamfilter="${f.key}" class="shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
      active ? 'border-amber-500 bg-amber-500 text-white shadow' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
    }">${f.label}</button>`;
  }).join('');
  const list = data.teams.filter((t: any) => teamFilter === 'all' || String(t.tier) === teamFilter);
  $('#teams-body').innerHTML = list.map((t: any) => `
    <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div class="mb-2 flex items-center gap-2">
        ${flagImg(t, 'h-7 w-10')}
        <div class="min-w-0 flex-1">
          <div class="truncate font-bold">${esc(t.name)}</div>
          <div class="truncate text-[11px] text-slate-400">${esc(t.owner)}</div>
        </div>
        ${tierBadge(t.tier)}
      </div>
      <div class="mb-3 text-xs text-slate-500 dark:text-slate-400">${t.champion ? 'World champions 🏆' : t.eliminated ? `Out · ${esc(t.furthestLabel)}` : `In the ${esc(t.furthestLabel)}`}</div>
      ${prizeChips(t.status)}
    </div>`).join('');
  document.querySelectorAll('[data-teamfilter]').forEach((b) =>
    b.addEventListener('click', () => { teamFilter = (b as HTMLElement).dataset.teamfilter!; renderTeams(); }));
}

// ---------- Fixtures (schedule) ----------
const LONDON = 'Europe/London';
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: LONDON });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LONDON });

function fixtureSide(team: any, ph: string, side: 'home' | 'away') {
  if (!team) return `<div class="text-xs italic text-slate-400 ${side === 'home' ? 'text-right' : ''}">${esc(ph || 'TBD')}</div>`;
  const order = side === 'home' ? 'flex-row-reverse text-right' : '';
  return `<div class="flex min-w-0 items-center gap-2 ${order}">
    ${flagImg(team, 'h-6 w-8')}
    <div class="min-w-0">
      <div class="truncate text-sm font-semibold">${esc(team.name)}</div>
      <div class="truncate text-[11px] text-slate-400">${esc(team.owner)}</div>
    </div>
  </div>`;
}

function fixtureCentre(f: any) {
  if (f.played) {
    const pens = f.homePen != null ? `<div class="text-[10px] text-slate-400">pens ${f.homePen}–${f.awayPen}</div>` : '';
    return `<div class="px-2 text-center"><div class="text-lg font-extrabold tabular-nums">${f.homeScore}–${f.awayScore}</div>${pens}</div>`;
  }
  return `<div class="px-2 text-center"><div class="text-sm font-bold tabular-nums text-slate-500 dark:text-slate-400">${timeLabel(f.date)}</div><div class="text-[10px] text-slate-400">BST</div></div>`;
}

function renderFixtures() {
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'group', label: 'Group stage' },
    { key: 'ko', label: 'Knockouts' },
  ];
  $('#fixtures-filter').innerHTML = filters.map((f) => {
    const active = fixtureFilter === f.key;
    return `<button data-fixfilter="${f.key}" class="shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
      active ? 'border-amber-500 bg-amber-500 text-white shadow' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
    }">${f.label}</button>`;
  }).join('');

  const list = data.fixtures.filter((f: any) =>
    fixtureFilter === 'all' || (fixtureFilter === 'group' ? f.depth === 0 : f.depth >= 1));

  // group by London day, preserving chronological order
  const days: { key: string; items: any[] }[] = [];
  for (const f of list) {
    const key = f.date ? dayLabel(f.date) : 'TBD';
    let bucket = days[days.length - 1];
    if (!bucket || bucket.key !== key) { bucket = { key, items: [] }; days.push(bucket); }
    bucket.items.push(f);
  }

  $('#fixtures-body').innerHTML = days.map((day) => `
    <div class="mb-5">
      <h3 class="sticky top-[57px] z-10 mb-2 bg-slate-100/90 py-1 text-sm font-bold text-slate-500 backdrop-blur dark:bg-slate-950/90 dark:text-slate-400">${esc(day.key)}</h3>
      <div class="space-y-2">
        ${day.items.map((f: any) => `
          <div class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div class="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-400">
              <span>${f.date ? timeLabel(f.date) + ' BST' : ''}</span>
              <span class="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-700/60">${esc(f.stage)}</span>
            </div>
            <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
              ${fixtureSide(f.home, f.homePlaceholder, 'home')}
              ${fixtureCentre(f)}
              ${fixtureSide(f.away, f.awayPlaceholder, 'away')}
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');

  document.querySelectorAll('[data-fixfilter]').forEach((b) =>
    b.addEventListener('click', () => { fixtureFilter = (b as HTMLElement).dataset.fixfilter!; renderFixtures(); }));
}

// ---------- view orchestration ----------
function renderCurrent() {
  if (view === 'prizes') renderPrizes();
  else if (view === 'fixtures') renderFixtures();
  else if (view === 'me') renderMe();
  else if (view === 'players') renderPlayers();
  else if (view === 'teams') renderTeams();
}

function showView(v: string) {
  view = v;
  document.querySelectorAll('[data-section]').forEach((s) =>
    s.classList.toggle('is-active', (s as HTMLElement).dataset.section === v));
  // Desktop top tabs: active = filled amber pill (matches the sub-tabs/filters).
  document.querySelectorAll('[data-navbar="top"] [data-nav]').forEach((b) => {
    const active = (b as HTMLElement).dataset.nav === v;
    b.className = `rounded-full px-3 py-1.5 text-sm font-semibold transition ${
      active
        ? 'bg-amber-500 text-white shadow'
        : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
    }`;
  });
  // Mobile bottom bar: active = amber pill behind the icon + amber bold label.
  document.querySelectorAll('[data-navbar="bottom"] [data-nav]').forEach((b) => {
    const active = (b as HTMLElement).dataset.nav === v;
    const pill = b.querySelector('[data-navpill]') as HTMLElement;
    const label = b.querySelector('[data-navlabel]') as HTMLElement;
    pill.className = `flex h-8 w-14 items-center justify-center rounded-full text-xl leading-none transition ${
      active ? 'bg-amber-500/20 dark:bg-amber-400/20' : ''
    }`;
    label.className = `text-[11px] font-semibold transition ${
      active ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
    }`;
  });
  if (location.hash.slice(1) !== v) history.replaceState(null, '', `#${v}`);
  renderCurrent();
}

function applyData(d: any) {
  data = d;
  // populate player selector once
  const sel = $('#me-select') as unknown as HTMLSelectElement;
  if (sel && !sel.options.length) {
    sel.innerHTML = data.people.map((p: any) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
    const fromUrl = new URLSearchParams(location.search).get('me');
    const stored = localStorage.getItem('shrew:me');
    me = [fromUrl, stored].find((n) => n && data.people.some((p: any) => p.name === n)) || data.people[0].name;
    sel.value = me!;
    sel.addEventListener('change', () => {
      me = sel.value;
      localStorage.setItem('shrew:me', me!);
      const url = new URL(location.href); url.searchParams.set('me', me!); history.replaceState(null, '', url);
      renderMe();
    });
  }
  const u = data.meta.updatedAt ? new Date(data.meta.updatedAt).toLocaleString() : '—';
  $('#updated').textContent = `${data.meta.playedMatches}/${data.meta.totalMatches} matches played · updated ${u}`;
  renderCurrent();
}

export function init() {
  data = JSON.parse($('#seed').textContent || '{}');

  // nav + subtab wiring
  document.querySelectorAll('[data-nav]').forEach((b) =>
    b.addEventListener('click', () => showView((b as HTMLElement).dataset.nav!)));
  const wantTab = new URLSearchParams(location.search).get('prize');
  if (PRIZES.some((p) => p.key === wantTab)) subtab = wantTab!;
  document.querySelectorAll('[data-subtab]').forEach((b) =>
    b.addEventListener('click', () => {
      subtab = (b as HTMLElement).dataset.subtab!;
      const url = new URL(location.href); url.searchParams.set('prize', subtab); history.replaceState(null, '', url);
      renderPrizes();
    }));

  applyData(data);
  showView(['prizes', 'fixtures', 'me', 'players', 'teams'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'prizes');

  // In production, pull fresh data and re-render if it changed. In dev we keep the
  // baked seed so `yarn snapshot <name>` previews work without the CDN overriding them.
  if (import.meta.env.PROD) {
    fetch(`${RESULTS_URL}?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((fresh) => { if (fresh && fresh.meta?.updatedAt !== data.meta?.updatedAt) applyData(fresh); })
      .catch(() => {});
  }
}
