# Status

Current state, open decisions, and next steps.
Delete items when they are resolved; history lives in git.

## Current state

The code is the prototype "second edition": ten hand-edited countries, thirty questions, three trails, and a 4K globe with progressive labels.
The platform workstream (migration steps 1 and 2) moved it to Next.js with path routes, a persistent globe in the root layout, an English-only message catalog, Prettier, Vitest, and CI.
The globe workstream (step 4) replaced the prototype globe with the `MapScene`-driven controller in `src/globe/`.
Until the content workstream is integrated, the prototype data lives in `src/content/legacy/`, and `src/domain/legacy-scene.ts` builds globe scenes from it.
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

## Known UI issues in the prototype

Fix these where the migration touches them, or explicitly drop them with the code they belong to.

- The home view shows only two or three country names; large countries such as Russia and Kazakhstan get none.
- Edited profiles repeat the generic "Where is X?" learning guide.
- Singapore's illustrative route visibly crosses land.
