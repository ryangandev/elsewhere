# Status

Current state, open decisions, and next steps.
Delete items when they are resolved; history lives in git.

## Current state

The code is the prototype "second edition": ten hand-edited countries, thirty questions, three trails, a bilingual interface, and a 4K globe with progressive labels.
It still runs on the ChatGPT Sites template (vinext on a Cloudflare Worker).
Product direction and target architecture were settled on 2026-10-26; see [product.md](product.md) and [architecture.md](architecture.md).
Migration is in progress.
Steps 1 to 4 run as parallel workstreams (platform, content schema, globe controller) and are integrated afterwards.

`README.md` and `QA.md` describe the prototype.
They are reduced to a short README during migration step 1, with lasting rationale moved into `architecture.md`.

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

- At a 1024 × 768 viewport, the home "Continue your wander" button overlaps the footer.
- The home view shows only two or three country names; large countries such as Russia and Kazakhstan get none.
- Jumping to the question list scrolls its heading partly out of view.
- Edited profiles repeat the generic "Where is X?" learning guide.
- Singapore's illustrative route visibly crosses land.
