# Status

Current state, open decisions, and next steps.
Delete items when they are resolved; history lives in git.

## Current state

Elsewhere is a Next.js static site with ten hand-edited countries, thirty questions, three trails, and a `MapScene`-driven 4K globe.
The platform workstream (migration steps 1 and 2) moved it to Next.js with path routes, a persistent globe in the root layout, an English-only message catalog, Prettier, Vitest, and CI.
The globe workstream (step 4) replaced the prototype globe with the controller in `src/globe/`; labels follow printed-atlas rules and stay apart from story places.
The content workstream (step 3) added the schema, the English edition in `content/en/` (files are discovered, not registered), and the gazetteer with sea passages.
Pages read only `content/en/` through server-only loaders, hand the shell serializable view models, and the browser loads two build-time indexes instead of content modules.
URLs use readable slugs; prototype query URLs redirect in the browser.
The content pipeline workstream (step 5) added generation, verification and review commands in `pipeline/`; no content has been generated with them yet.
The question-first experience (step 6) made the home a question input with suggested questions from `content/en/home.json`, shared with Cmd K.
Step 7 has started: Playwright e2e tests cover the core loop on desktop and phone, and a visual polish pass covered every surface at 1440, 1024 and 390 pixels wide.
What remains of step 7 is the pilot batch and the public deployment, both waiting on Ryan.
Product direction and target architecture were settled on 2026-10-26; see [product.md](product.md) and [architecture.md](architecture.md).

## Confirmed decisions (2026-10-26)

- Next.js replaces vinext; Stage 1 deploys as a static site on Vercel.
- No live answers in Stage 1; the reviewed question bank comes first.
- The pilot batch is about 20 countries, each with an overview and 4 to 6 questions, to tune prompts and the review bar.

## Waiting on Ryan

- The pilot batch is ready to run once there is an API key; see [Content pipeline](architecture.md#content-pipeline).
  1. Fill in `ANTHROPIC_API_KEY` in `.env.local` at the repository root (a git-ignored copy of `.env.example`); it is never printed.
  2. Check the country list and reasons in `pipeline/batches/pilot.json`.
  3. Run `npm run content:generate -- --batch pilot --plan-only`, then read and edit `pipeline/batches/pilot.plan.json` (about $1).
  4. Run `npm run content:generate -- --batch pilot` (about $20 to $60; add `--mode batch` for roughly half the token cost and a slower run).
  5. Run `npm run content:verify`, then review each country with `npm run content:review -- show <country>`, followed by `approve` or `revise --notes "..."`, and `npm run content:generate -- --revisions` for what you sent back.

- Deployment: create the Vercel project from this repository (framework preset Next.js; the build already exports `out/`), then move the prototype query URL redirect to Vercel `redirects`.
  The site needs no environment variables: content is generated offline and committed, so the API key never goes to Vercel or CI.

## Known content pipeline issues

- Some Singapore claims cite only the National Library Board article "Looking back at 700 years of Singapore" (`nlb-singapore-history`), which does not state them: the "Capital" and "Currency" quick facts, and "housing" in the wealth story's "Build what the world needs" step (the MAS economic history now covers the rest of that step).
  The other nine hand-converted countries have not been checked claim by claim against their sources; do that before they are treated like pipeline-reviewed content.

## Next steps

Follow [Migration plan](architecture.md#migration-plan).

## Known issues

Fix these where the migration touches them, or explicitly drop them with the code they belong to.

- In development, an unknown path such as `/atlantis` answers 500 instead of 404 unless the request asks for HTML, because `output: 'export'` forbids unknown params; the static build serves a plain 404.
  The icons the browser requests on its own are real files (`app/favicon.ico`, `app/apple-icon.png`), so they are not affected.
- The prototype query URL redirect runs in the browser; move it to Vercel `redirects` when the site deploys there.
- Search is lexical: prefix matching, TF-IDF keywords and a short synonym list.
  A question phrased with none of a story's words ("What makes Singapore wealthy?" works, "Why is Singapore loaded?" does not) is reported as unanswered; revisit with embeddings or pipeline-generated paraphrases once the question bank grows.
- Same-country next questions carry no `reason` in content, so the story shows only "Deeper in <country>" for them; the pipeline could write one.
