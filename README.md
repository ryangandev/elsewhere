# Elsewhere

An interactive world atlas for people who follow their curiosity.
The globe stays present while a short country overview opens into deeper, place-specific questions.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open the URL printed by the server, normally http://localhost:5173.

```sh
npx tsc --noEmit
npm run build
npm start
```

## First edition

- A Three.js globe with locally bundled Earth imagery and Natural Earth country boundaries.
- Eight edited country profiles: Singapore, Japan, Brazil, Turkey, China, United States, France, and India.
- Twenty-four topics, with contextual geographic labels and illustrative routes.
- Search with keyboard navigation, direct country selection, zoom controls, reset, and a random destination.
- Responsive country panels that preserve the map on desktop and mobile.
- Sources and dated population figures inside each country profile.

The interface is in English.
Countries outside the first eight can be located on the globe, but do not have full editorial profiles.
The simplified boundary dataset omits some small countries, including Singapore; an explicit geographic marker keeps Singapore selectable.
Routes illustrate geographic relationships and are not exact shipping, river, or historical tracks.

## Structure

- `app/page.tsx`: exploration state, navigation, and editorial interface.
- `app/Globe.tsx`: WebGL lifecycle, camera transitions, country interaction, labels, and routes.
- `app/data.ts` and `app/other-countries.ts`: typed editorial content, sources, and geographic context.
- `app/globals.css`: visual system and responsive layouts.
- `public/maps/`: bundled globe texture and country geometry.

Built with React, TypeScript, Vinext, Globe.GL, Three.js, Lucide, and the supplied accessible Radix primitives.
The selected country and topic provide a natural context boundary for a future chat component.
There is no AI backend, account system, application database, analytics, or third-party API dependency at runtime.
The Sites host may require sign-in because this deployment is private.

## Editorial and map sources

Population figures are rounded 2024 values from the World Bank, except Singapore, which uses SingStat.
Each country includes links to relevant institutional sources.
Earth texture: NASA Blue Marble via the open-source three-globe example assets.
Boundaries: Natural Earth via the Globe.GL example dataset.
Simplified boundaries are for exploration and are not an endorsement of territorial claims.

## Verification

The release is checked with TypeScript, a production build, and browser interactions at desktop and mobile breakpoints.
See `QA.md` for the exercised flows and known limits.
