# Status

Current state, open decisions, and next steps.
Delete items when they are resolved; history lives in git.

## Current state

Elsewhere is a Next.js static site with ten hand-edited countries, thirty questions, three trails, and a `MapScene`-driven 4K globe.
The platform workstream (migration steps 1 and 2) moved it to Next.js with path routes, a persistent globe in the root layout, an English-only message catalog, Prettier, Vitest, and CI.
The globe workstream (step 4) replaced the prototype globe with the controller in `src/globe/`; labels follow printed-atlas rules and stay apart from story places.
The content workstream (step 3) added the schema, the English edition in `content/en/` (files are discovered, not registered), and the gazetteer with sea passages.
Pages read only `content/en/` through server-only loaders, hand the shell serializable view models, and the browser loads two build-time indexes instead of content modules.
URLs use readable slugs; prototype query URLs get permanent redirects from `vercel.json`.
The content pipeline workstream (step 5) added generation, verification, claim check and review commands in `pipeline/`, agent drafting, which drafts a country in a Claude Code subagent with the same checks, and the agent claim check, which checks claims in a subagent and verifies every quote against a live fetch; no content has been committed from them yet.
The question-first experience (step 6) made the home a question input with suggested questions from `content/en/home.json`, shared with Cmd K.
Search also matches paraphrases of each question, written offline by `npm run content:paraphrase`, so a question in a reader's own words finds its story; every story has them.
Step 7 has started: Playwright e2e tests cover the core loop on desktop and phone, and a visual polish pass covered every surface at 1440, 1024 and 390 pixels wide.
What remains of step 7 is the pilot batch and the public deployment, both waiting on Ryan.
Product direction and target architecture were settled on 2026-10-26; see [product.md](product.md) and [architecture.md](architecture.md).

## Confirmed decisions (2026-10-26)

- Next.js replaces vinext; Stage 1 deploys as a static site on Vercel.
- No live answers in Stage 1; the reviewed question bank comes first.
- The pilot batch is about 20 countries, each with an overview and 4 to 6 questions, to tune prompts and the review bar.

## Waiting on Ryan

- The pilot batch is ready to run once there is an API key for planning and search phrasings; drafting and claim checks can run in Claude Code subagents instead.
  See [Content pipeline](architecture.md#content-pipeline).
  1. Fill in `ANTHROPIC_API_KEY` in `.env.local` at the repository root (a git-ignored copy of `.env.example`); it is never printed.
  2. Check the country list and reasons in `pipeline/batches/pilot.json`.
  3. Run `npm run content:generate -- --batch pilot --plan-only`, then read and edit `pipeline/batches/pilot.plan.json` (about $1).
  4. Run `npm run content:generate -- --batch pilot` (about $9 a country at `max` effort, measured on the pilot, less at the default `high`; add `--mode batch` for roughly half the token cost and a slower run).
     Or draft without API credit: ask Claude Code to run the `content-drafter` subagent for each country in the batch, which drafts through `npm run content:agent` from the same plan; see [Agent drafting](architecture.md#agent-drafting).
  5. Run `npm run content:verify`, then check the drafted text against its sources: ask Claude Code to run the `claim-checker` subagent for each country, which checks through `npm run content:claims-agent` and saves only verdicts whose quotes are on the live pages; see [Agent claim check](architecture.md#agent-claim-check).
     For a large country, run `npm run content:claims-agent -- start <country>` first and give each session it prints to its own subagent.
     `start <country> --overview` checks only the overview units and `start <country> <story>` only one story; add `--recheck` to check units that already have a result.
     The API claim check, `npm run content:claims -- --drafts`, is kept as a reserve with the same results (roughly $1 to $3 a country, more when a source is a long PDF).
  6. Run `npm run content:paraphrase -- --all` to write search phrasings for the new stories (a few cents per country).
  7. Review each country with `npm run content:review -- show <country>`, followed by `approve` or `revise --notes "..."`, and `npm run content:generate -- --revisions` for what you sent back, or the `content-drafter` subagent with `npm run content:agent -- start <country> --revisions` to redraft a country's sent-back overview and stories without API credit.
     `revise <country> --overview --notes "..."` sends back only a country's overview, quick facts, starter questions and scene, keeping its stories.
     Approval needs a current claim check with nothing flagged; after opening a flagged source yourself, `approve --accept-claims "<why>"` records why it is fine.
     Commit `content/en/claims/` together with the reviewed country files.

- Deployment: the repository is ready for Vercel; only the project itself is missing.
  The site needs no environment variables: content is generated offline and committed, so the API key never goes to Vercel or CI.
  See [How Vercel serves it](architecture.md#platform) for what `vercel.json` does.
  1. In Vercel, choose Add New, then Project, and import this GitHub repository; `main` is the production branch.
  2. Keep the detected framework preset, Next.js, and the root directory at the repository root.
  3. Leave Build Command, Output Directory and Install Command at their defaults: the build runs `npm run build`, and the Next.js builder finds the static export in `out/` by itself, so do not set Output Directory to `out`.
  4. Add no environment variables, and keep "Enable access to System Environment Variables" checked under Settings, then Environment Variables (it is on by default), because canonical links, robots.txt and the sitemap use `VERCEL_PROJECT_PRODUCTION_URL`.
  5. Deploy, then check the production URL: the home page and a story render with the globe, `/atlantis` shows the designed not-found page, and `curl -sI "https://<domain>/?country=sgp&topic=shipping"` answers 308 with `location: /singapore/shipping` (Vercel may append the original query string, which the page ignores).
  6. For a custom domain, add it under Settings, then Domains, let Vercel redirect the other of apex and `www` to it, and redeploy, so canonical links, robots.txt and the sitemap switch from the `vercel.app` address to it.

## Known content pipeline issues

- The claim check flags most of the hand-converted text it has seen (2026-10-26, a scratch copy of `content/en`, nothing changed).
  Singapore: 12 of 14 units flagged.
  The "Capital" and "Currency" quick facts cite only `nlb-singapore-history`, which states neither; "housing" in "Build what the world needs" is the one part of that step neither source states; "Move up the value chain" cites an MND written answer whose text only appears with scripts, so it cannot be read; both shipping sections ask more of the MPA page than it says.
  Japan: 11 of 13 units flagged, including the "Capital" and "Language" quick facts and "The less visible strengths", which the statistics handbook does not state.
  Most flags are true facts cited to a page that does not say them, so the fix is usually a better source rather than different text.
  The other eight hand-converted countries have not been checked; run `npm run content:claims -- --all` before they are treated like pipeline-reviewed content.
- Claim check follow-ups:
  `--mode batch` has no `--resume`, so a round in flight is lost when a run stops (results already saved stay, and the next run checks only what is still due).
  The server-side fetch's size cap does not apply to PDFs, so a long statistics PDF costs its full length on every read (Japan's 475k-token handbook is about $2.40 a read); consider a local text extract or a page range for large PDFs.
  The United Kingdom, Russia, Netherlands and Nigeria checks of the first nine-country run did not finish; rerun them live to measure the default bound of 10 sources per conversation (set from the pilot's page sizes, not yet measured).
  Their recordings are one conversation per country, so replaying them needs `--sources-per-session 100`; with it, all three recorded countries pass.
  On repair turns the model sometimes garbles non-ASCII characters it copied correctly before (a curly apostrophe, a minus sign or a degree sign becomes a line break or a literal `\u2212`); keeping each unit's latest passing verdict covers a unit that passed earlier, but a unit that had not passed yet can fail on the garbled quote.
  Packing conversations by shared sources is greedy, not optimal; if shared sources read twice cost noticeably, try a better packing.
- The search phrasings of the ten hand-converted countries were written by `npm run content:paraphrase` on 2026-10-26 and checked by the agent that ran it (every name and number appears in its story's text); Ryan has not read them yet.
  They show in `npm run content:review -- show <country>`.

## Next steps

Follow [Migration plan](architecture.md#migration-plan).

## Known issues

Fix these where the migration touches them, or explicitly drop them with the code they belong to.

- In development, an unknown path such as `/atlantis` answers 500 instead of 404 unless the request asks for HTML, because `output: 'export'` forbids unknown params; the static build and Vercel answer 404 with the designed not-found page.
  The icons the browser requests on its own are real files (`app/favicon.ico`, `app/apple-icon.png`), so they are not affected.
- Search is lexical: prefix matching, TF-IDF keywords, a short synonym list, and pipeline-written paraphrases of each question, so "Why is Singapore loaded?" now finds the wealth story.
  A question whose words appear in none of these is still reported as unanswered, even when a story answers it ("How did China get rich?" lists the manufacturing and reform stories as closest); revisit with embeddings if that becomes common as the bank grows.
- Same-country next questions carry no `reason` in content, so the story shows only "Deeper in <country>" for them; the pipeline could write one.
