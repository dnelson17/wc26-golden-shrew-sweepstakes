# CLAUDE.md

Live prize trackers for 2026 World Cup sweepstakes — multiple "leagues" overlaid on
the same tournament (same matches, different ownership + prize sets). Static site that
re-fetches live results from a CDN at runtime.

## Stack

Astro 6 + Tailwind 4, TypeScript; static build → Cloudflare Pages. Node ≥22, npm. The
data pipeline is plain `.mjs`. No backend — an hourly GitHub Action computes results and
commits JSON.

## Structure

- `src/leagues.ts` — league registry (branding, prize set, ownership mode, CDN URL); start here.
- `src/pages/[league].astro` — per-league dashboard route; `index.astro` is the picker at `/`.
- `src/scripts/app.ts` — client dashboard (renders a baked seed, then live CDN data).
- `src/types.ts` — the data contract shared by `compute.mjs` and the client.
- `scripts/` — pipeline: `compute.mjs` (pure prize logic), `fetch.mjs` (FIFA→results),
  `simulate.mjs` (odds→snapshots), `use-snapshot.mjs`.
- `data/` — `draw_results*.json` (inputs), `results*.json` (outputs), `snapshots/`, `odds/`.

See README.md for the data-flow diagram, deployment, and the league table.

## Commands

- `npm run dev` — local dev server
- `npm run build` — static build to `dist/`
- `npm run check` — type-check (Astro + `.mjs` via checkJs)
- `npm run test:compute` — prize-logic assertions (both ownership modes)

Pre-commit (husky + lint-staged) runs eslint + prettier; commitlint enforces Conventional
Commits (plus a `data:` type).

## Conventions

- **Never push to origin without explicit user approval.** Cloudflare Pages builds are
  rate-limited and every push consumes one. Commit freely; push only when asked.
- **Don't hand-edit or commit `data/results*.json`** — the bot regenerates them hourly
  (`[skip ci]`). Keep live-data churn out of code commits.
- **`scripts/*.mjs` are typed**, not loose JS (JSDoc + `checkJs`; verify with `npm run check`).
  `compute.mjs` is one engine over two ownership modes: `Draw` is a discriminated union —
  `tiered-pair` (Golden Shrew, group1/group2 per player) and `full-group` (Nelson, one FIFA
  group per player). Narrow on `ownershipMode`; `tier` is `null` when untiered.

## Deeper context

- README.md — architecture, data flow, Cloudflare deployment, preview snapshots.
- `src/types.ts` — full `Results` shape.
