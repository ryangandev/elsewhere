# Status

Current state, open decisions, and next steps.
Delete items when they are resolved; history lives in git.

## Current state

The code is the prototype "second edition": ten hand-edited countries, thirty questions, three trails, and a 4K globe with progressive labels.
The platform workstream (migration steps 1 and 2) moved it to Next.js with path routes, a persistent globe in the root layout, an English-only message catalog, Prettier, Vitest, and CI.
The globe workstream (step 4) replaced the prototype globe with the `MapScene`-driven controller in `src/globe/`.
The content workstream (step 3) added the schema, the English edition in `content/en/`, and the gazetteer.
The content wiring removed the prototype data: pages read only `content/en/` through server-only loaders, hand the shell serializable view models, and the browser loads two build-time indexes instead of content modules.
URLs use readable slugs; prototype query URLs and interim ID paths redirect in the browser.
The content pipeline workstream (step 5) added generation, verification and review commands in `pipeline/`; no content has been generated with them yet.
Product direction and target architecture were settled on 2026-10-26; see [product.md](product.md) and [architecture.md](architecture.md).
Migration is in progress.
Steps 1 to 5 are merged; step 6 (question-first experience) is in progress.

## Confirmed decisions (2026-10-26)

- Next.js replaces vinext; Stage 1 deploys as a static site on Vercel.
- No live answers in Stage 1; the reviewed question bank comes first.
- The pilot batch is about 20 countries, each with an overview and 4 to 6 questions, to tune prompts and the review bar.

## Waiting on Ryan

- The pilot batch is ready to run once there is an API key; see [Content pipeline](architecture.md#content-pipeline).
  1. Put `ANTHROPIC_API_KEY=...` in `.env.local` at the repository root; it is git-ignored and never printed.
  2. Check the country list and reasons in `pipeline/batches/pilot.json`.
  3. Run `npm run content:generate -- --batch pilot --plan-only`, then read and edit `pipeline/batches/pilot.plan.json` (about $1).
  4. Run `npm run content:generate -- --batch pilot` (about $20 to $60; add `--mode batch` for roughly half the token cost and a slower run).
  5. Run `npm run content:verify`, then review each country with `npm run content:review -- show <country>`, followed by `approve` or `revise --notes "..."`, and `npm run content:generate -- --revisions` for what you sent back.

## Known content pipeline issues

- Sea routes cannot pass the Suez or Panama canals, the Strait of Hormuz, Bab-el-Mandeb, the Bristol Channel, Hudson Strait, the Northwest Passage, the Saint Lawrence River or the Strait of Magellan: the first three are missing from the gazetteer and the others have passage paths that cross land.
  Drafts fall back to `flow` routes there; fixing the gazetteer needs the Natural Earth sources (`npm run maps:gazetteer`).
- Two source URLs in reviewed content are gone (HTTP 404): India's `rajbhasha.gov.in` languages page and Singapore's `population2024.pdf`, so `npm run content:verify` fails until they are replaced.
  IBGE (Brazil) and two UNESCO pages (France, Turkey) refuse automated checks (HTTP 403) and need a manual look.
- Generated country files must be registered in `src/content/registry.ts` before `npm run content:check` passes.

## Next steps

Follow [Migration plan](architecture.md#migration-plan).

## Known issues

Fix these where the migration touches them, or explicitly drop them with the code they belong to.

- The home view shows only two or three country names; large countries such as Russia and Kazakhstan get none.
- The home picks are a fixed list of four country IDs in `src/domain/page-views.ts` until the question-first home (step 6) replaces them.
- In development, the browser's automatic `/favicon.ico` request matches `app/[country]` and logs a 500, because `output: 'export'` forbids unknown params; the static build serves a plain 404.
- Redirects from old URLs run in the browser; move them to Vercel `redirects` when the site deploys there.
