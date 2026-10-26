# Status

Current state, open decisions, and next steps.
Delete items when they are resolved; history lives in git.

## Current state

The code is the prototype "second edition": ten hand-edited countries, thirty questions, three trails, and a 4K globe with progressive labels.
The platform workstream (migration steps 1 and 2) moved it to Next.js with path routes, a persistent globe in the root layout, an English-only message catalog, Prettier, Vitest, and CI.
The globe workstream (step 4) replaced the prototype globe with the `MapScene`-driven controller in `src/globe/`.
The content workstream (step 3) added the schema, the English edition in `content/en/`, and the gazetteer.
The content wiring removed the prototype data: pages read only `content/en/` through server-only loaders, hand the shell serializable view models, and the browser loads two build-time indexes instead of content modules.
URLs use readable slugs; prototype query URLs redirect in the browser.
The content pipeline workstream (step 5) added generation, verification and review commands in `pipeline/`; no content has been generated with them yet.
The question-first experience (step 6) made the home a question input with suggested questions from `content/en/home.json`, shared with Cmd K.
Product direction and target architecture were settled on 2026-10-26; see [product.md](product.md) and [architecture.md](architecture.md).
Migration is in progress.
Steps 1 to 6 are merged; step 7 (scale and ship) is next.

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

- Singapore's "Language" quick fact and its "Move up the value chain" step cite only `singstat-population-2024` (SingStat Population Trends), which states population and ethnic composition but not the official languages, the national language, or inequality.
  They need a source that states those claims, such as the Constitution of Singapore (Article 153A) for languages.

## Next steps

Follow [Migration plan](architecture.md#migration-plan).

## Known issues

Fix these where the migration touches them, or explicitly drop them with the code they belong to.

- In development, an unknown path such as `/atlantis`, and the browser's automatic `/favicon.ico` request, answer 500 instead of 404, because `output: 'export'` forbids unknown params; the static build serves a plain 404.
- The prototype query URL redirect runs in the browser; move it to Vercel `redirects` when the site deploys there.
- Search is lexical: prefix matching, TF-IDF keywords and a short synonym list.
  A question phrased with none of a story's words ("What makes Singapore wealthy?" works, "Why is Singapore loaded?" does not) is reported as unanswered; revisit with embeddings or pipeline-generated paraphrases once the question bank grows.
- Same-country next questions carry no `reason` in content, so the story shows only "Deeper in <country>" for them; the pipeline could write one.
- The header search shows the Mac shortcut (⌘K) on every platform; Ctrl K works but is not labelled.
