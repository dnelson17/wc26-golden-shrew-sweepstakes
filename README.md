# 🪵 World Cup Sweepstakes 🏆

Live prize trackers for 2026 World Cup sweepstakes — multiple leagues overlaid on
the same tournament. The root path (`/`) is a league picker; each league has its own
page and re-fetches its own live data.

## Leagues

| Slug           | Path            | Players | Ownership                               | Prizes                           |
| -------------- | --------------- | ------- | --------------------------------------- | -------------------------------- |
| `golden-shrew` | `/golden-shrew` | 24      | one strong + one weak team each         | Winner, 3rd, best group-2, shrew |
| `nelson`       | `/nelson`       | 12      | a whole FIFA group (A–L) each, ~4 teams | Winner, 3rd, shrew               |

Leagues are configured in **`src/leagues.ts`** (branding, prize set, ownership mode,
CDN URL). The prizes:

| Prize             | Emoji | Amount | Won by                                                              |
| ----------------- | :---: | -----: | ------------------------------------------------------------------- |
| Winner            |  🏆   |   £120 | The tournament champions                                            |
| 3rd place         |  🥉   |    £40 | Winner of the 3rd-place play-off                                    |
| Best group-2 side |  🪖   |    £40 | The group-2 team that goes furthest, then most goals (Golden Shrew) |
| Wooden shrew      |  🪵   |    £40 | The worst team overall (fewest pts, worst GD, …)                    |

## How it works

```
GitHub Actions (hourly) ──► scripts/fetch.mjs ──► data/results*.json ──► git commit [skip ci]
        cron                  (FIFA API + compute)                               │
                                                                                 ▼
                                          Cloudflare Pages site ◄── fetch() at runtime
```

- **`data/draw_results*.json`** — each league's draw (who owns which team), enriched
  with FIFA team IDs + ISO flag codes. `draw_results.json` is Golden Shrew (tiered-pair);
  `draw_results.nelson.json` is Nelson (full-group, with a group→owner map).
- **`scripts/fetch.mjs`** — pulls all 104 matches from the FIFA calendar API **once**, then
  runs the prize logic for every league, writing each `data/results*.json` (only when
  something changed).
- **`scripts/compute.mjs`** — pure prize logic (standings, knockout bracket, per-team &
  per-player prize statuses, league table, fixtures). Supports both ownership modes
  (tiered-pair, full-group). Unit-tested for each.
- **The site** is static (Astro + Tailwind). Each league page (`/[league]`) bakes its
  latest results as a seed for instant first paint, then **fetches its live results file
  from the CDN at runtime** and re-renders. So data updates never require a rebuild.

Flags render from `https://flagcdn.com/<iso2>.svg` (works for England/Scotland too).

## Commands

| Command                   | Action                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run dev`             | Local dev server (uses the baked `results.json`, no CDN fetch)                                     |
| `npm run build`           | Production build to `./dist/`                                                                      |
| `npm run fetch`           | Fetch live FIFA data → `results.json` (no-op outside the tournament window; `FORCE=1` to override) |
| `npm run simulate`        | Regenerate the simulated tournament + all snapshots from the odds                                  |
| `npm run snapshot <name>` | Copy a snapshot into `results.json` to preview a stage                                             |
| `npm run test:compute`    | Run the prize-logic assertions                                                                     |

### Previewing different stages

The whole tournament is simulated from betting odds so the dashboard can be previewed at
any point. Snapshots live in `data/snapshots/` (currently Golden Shrew only — they write
`data/results.json`):

```bash
npm run snapshot 02-group-complete   # 00-start · 01-group-md1 · 02-group-complete · 03-r16-half · 04-finished
npm run dev                          # dev keeps the seed, so the snapshot shows as-is
```

Deep links live under a league path, e.g. `/golden-shrew?me=Josh#me`,
`/golden-shrew?prize=shrew#prizes`.

## Deployment — Cloudflare Pages (free)

See the build settings below. Two things keep us comfortably inside the free **500
builds/month** limit:

1. The bot's data commits carry `[skip ci]`, so Cloudflare ignores them.
2. We only push code to `main` when a change is ready (iterate locally first).

**Build settings** (Cloudflare Pages → connect this repo):

| Field                  | Value                 |
| ---------------------- | --------------------- |
| Framework preset       | Astro                 |
| Build command          | `npm run build`       |
| Build output directory | `dist`                |
| Production branch      | `main`                |
| Environment variable   | `NODE_VERSION` = `22` |

If you ever rename the repo, update each league's `resultsUrl` in `src/leagues.ts`.

### Iterating without burning deploys

- Do all development with `npm run dev` + snapshots — nothing is deployed.
- Push to `main` only when a feature is done → that's one build.
- Need to share a work-in-progress live? Push a **branch** — Cloudflare builds a temporary
  preview URL for it (costs one build; use sparingly).
