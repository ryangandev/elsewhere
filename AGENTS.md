# Elsewhere

A question-first world atlas: ask why, see the answer on a 3D globe, follow a connected question elsewhere.
Start with [docs/README.md](docs/README.md) and read only the section it routes you to.

The codebase is mid-migration from a prototype to the target in [docs/architecture.md](docs/architecture.md).
Check [docs/status.md](docs/status.md) for which migration step is current before changing structure.

## Commands

```sh
npm ci
npm run dev        # http://localhost:3000
npm run typecheck
npm run lint
npm test
npm run build      # static export to out/
npm run format     # Prettier
```

## Rules

- Build English only for now; do not add or update Chinese content. See [Language](docs/product.md#language).
- Every answer must cite real sources; unsourced claims do not ship. See [Content](docs/product.md#content).
- Reference stories and countries by permanent ID, never by array index or title. See [Content model](docs/architecture.md#content-model).
- Map places come from the gazetteer, never from hand- or model-written coordinates. See [Content pipeline](docs/architecture.md#content-pipeline).
- Keep the 4K image basemap and sphere-based picking; they were chosen by measurement. See [Globe](docs/architecture.md#globe).
- Do not change [docs/product.md](docs/product.md) without Ryan's agreement.
- Interface strings live in the message catalog in `src/i18n/`, keyed by message ID. See [Internationalization](docs/architecture.md#internationalization).
- Write readable, normally formatted code. Run `npm run format` before committing.
