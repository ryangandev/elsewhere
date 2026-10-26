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
Product direction and target architecture were settled on 2026-10-26; see [product.md](product.md) and [architecture.md](architecture.md).
Migration is in progress.
Steps 1 to 4 run as parallel workstreams (platform, content schema, globe controller) and are integrated afterwards.

## Confirmed decisions (2026-10-26)

- Next.js replaces vinext; Stage 1 deploys as a static site on Vercel.
- No live answers in Stage 1; the reviewed question bank comes first.
- The pilot batch is about 20 countries, each with an overview and 4 to 6 questions, to tune prompts and the review bar.

## Waiting on Ryan

- An Anthropic API key for the content pipeline, needed before the pilot batch can be generated.

## Next steps

Follow [Migration plan](architecture.md#migration-plan).

## Known issues

Fix these where the migration touches them, or explicitly drop them with the code they belong to.

- The home view shows only two or three country names; large countries such as Russia and Kazakhstan get none.
- The home picks are a fixed list of four country IDs in `src/domain/page-views.ts` until the question-first home (step 6) replaces them.
- In development, an unknown path such as `/atlantis` answers 500 instead of 404, because `output: 'export'` forbids unknown params; the static build serves a plain 404.
- The prototype query URL redirect runs in the browser; move it to Vercel `redirects` when the site deploys there.
