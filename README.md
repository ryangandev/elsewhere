# Elsewhere

A question-first world atlas: ask why, see the answer on a 3D globe, follow a connected question elsewhere.

## Run locally

Requires Node 22 or newer.

```sh
npm ci
npm run dev        # http://localhost:3000
```

The site is exported as static files.
`npm run build` writes them to `out/`, and `npm start` serves that folder.

Other scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run format`.

## Documentation

Start with [docs/README.md](docs/README.md).
It routes each question to the one document that answers it: product contract, architecture, and current status.
