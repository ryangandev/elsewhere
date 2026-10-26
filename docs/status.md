# Status

Current state, open decisions, and next steps.
Delete items when they are resolved; history lives in git.

## Current state

The code is the prototype "second edition": ten hand-edited countries, thirty questions, three trails, a bilingual interface, and a 4K globe with progressive labels.
It still runs on the ChatGPT Sites template (vinext on a Cloudflare Worker).
Product direction and target architecture were settled on 2026-10-26; see [product.md](product.md) and [architecture.md](architecture.md).
The codebase has not started the migration yet.

`README.md` and `QA.md` describe the prototype.
They will be reduced to a short README during migration step 1, with lasting rationale moved into `architecture.md`.

## Open decisions

- **Hosting for Stage 1.** Proposed: Vercel static deployment. Needs Ryan's confirmation.
- **Live answers in Stage 1.** Proposed: not in Stage 1; the question bank must be large enough first. Revisit after the pilot batch.
- **Pilot batch scope.** Proposed: about 20 countries with an overview and 4 to 6 questions each, to tune prompts and the review bar.

## Next steps

Follow [Migration plan](architecture.md#migration-plan), starting with step 1.

## Known UI issues in the prototype

Fix these where the migration touches them, or explicitly drop them with the code they belong to.

- At a 1024 × 768 viewport, the home "Continue your wander" button overlaps the footer.
- The home view shows only two or three country names; large countries such as Russia and Kazakhstan get none.
- Jumping to the question list scrolls its heading partly out of view.
- Edited profiles repeat the generic "Where is X?" learning guide.
- Singapore's illustrative route visibly crosses land.
