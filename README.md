# Elsewhere

A world atlas for the questions that come before the deep dive.
Start with a country, build a mental model in a minute, then follow a question across the globe.
The map stays present throughout.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

The development server normally runs at http://localhost:5173.
To verify and run the production bundle locally:

```sh
npx tsc --noEmit
npm run lint
npm test
npm run build
npm start -- --port 8787
```

`npm start` runs the built Cloudflare worker locally.
It does not deploy a site.
After rebuilding, restart `npm start` so the preview loads the new asset manifest.

## The second edition

- Ten edited country profiles: Singapore, Japan, Brazil, Turkey, China, United States, France, India, Malaysia, and Indonesia.
- Thirty country-specific questions covering geography, history, identity, nature, and economic connections.
- Three editorial trails: **The water between us**, **Made in many places**, and **The land shapes the story**.
- Clickable geographic context in both the reading panel and globe, with explanations of key places and links to related country stories.
- Cross-country recommendations explain why the next question is connected to the current one.
- Search accepts country names, selected aliases, and keywords in natural questions.
- The bundled Natural Earth directory contains 178 selectable locations, including the additional Singapore marker.
- Every mapped country has a white center marker; names appear when the projected land area and available space allow, and hover or keyboard focus reveals any smaller country's name.
- Places without a full profile have a location guide and nearby editorial destinations instead of an interruption dialog.
- Stable links preserve country, question, and trail; refresh and browser back/forward restore the view.
- Your atlas saves countries and questions locally, with recent exploration and a home-screen continuation entry.
- On mobile, the reading panel can collapse to give the globe more space, then expand to continue reading.
- Reduced-motion support, keyboard navigation, focus management, clipboard fallback, and a story interface that remains usable if WebGL fails.

Try a connected exploration:

```text
/?country=sgp&topic=shipping&trail=water-connects
```

Search for `Singapore` to open its overview, or `Why is Singapore so rich?` to find relevant edited stories.
Search is editorial retrieval, not an AI conversation.

## Interaction

Use `⌘ K` or `Ctrl K` to search.
Arrow keys and Enter navigate results.
Escape closes a dialog first; on the map it clears a selected geographic place, returns from a topic to the country, then returns to the world.
The bookmark saves the current country or question, and the link button copies a URL for the current view.
Trail stops are freely navigable, with no scores or required completion order.

## Structure

- `app/page.tsx`: page composition, global controls, dialogs, map focus, and transient feedback.
- `app/ExplorerPanel.tsx`: country overviews, topics, map explanations, sources, and connected stories.
- `app/AtlasDialogs.tsx`: country/question search, trails, and the personal atlas.
- `app/Globe.tsx`: WebGL lifecycle, camera transitions, labels, country selection, and illustrative routes.
- `app/exploration.ts`: destination validation, URLs, directory, trails, recommendations, geographic explanations, and search.
- `app/use-atlas.ts`: browser-history integration and validated local persistence.
- `app/data.ts`, `app/other-countries.ts`, `app/southeast-asia.ts`: typed editorial content with permanent topic IDs.
- `app/country-index.json`: compact location directory derived from bundled geometry.
- `scripts/build-country-index.mjs`: regenerate the directory with `npm run maps:index`.
- `tests/exploration.test.ts`: data integrity, URL restoration, trail links, search, location sanity, and persistence validation.

Topic IDs live with their content and do not depend on display titles or ordering.
The selected destination is also the context boundary for a future assistant.
The geography directory uses the largest polygon’s spherical centroid instead of assuming optional label coordinates exist in the dataset.

## Local data and privacy

Bookmarks and recent destinations use `elsewhere.library.v1` in localStorage.
Up to 100 saved destinations and 20 recent destinations are retained.
If storage is unavailable, the current session retains the choices and the personal atlas explains the limitation.
No account is needed; bookmarks and reading history are not transmitted to a server.
They are specific to this browser and site origin and do not sync across devices.

There is no AI backend, analytics service, application database, or third-party runtime data API.
All editorial content, map geometry, and globe imagery are bundled locally.
The existing private Sites deployment may require sign-in at the hosting layer.
This local iteration does not change that deployment or its access settings.

## Editorial and map sources

Population figures remain a dated 2024 reference, not live statistics.
Most use World Bank estimates; Singapore uses SingStat and Malaysia uses DOSM.
Indonesia’s capital is explicitly shown as a 2024 reference.
The new Malaysia stories draw on its government portal, DOSM, and MIDA.
The new Indonesia stories draw on the World Bank and Indonesia’s Ministry of Tourism.
Country profiles expose their sources; the new topics also expose topic-specific reading links.
Older topics distinguish country-level background sources from direct topic references.

Earth texture: NASA Blue Marble via the open-source three-globe example assets.
Boundaries: Natural Earth via the Globe.GL example dataset.
The simplified dataset omits some small countries; Singapore has an explicit selectable marker.
Names and boundaries are for exploration and do not endorse territorial claims.
Map paths illustrate relationships and are not exact shipping, river, or historical tracks.

## Verification and scope

See `QA.md` for the exercised browser flows and validation results.
The interface is English; search includes selected native-language country aliases.
Full editorial coverage is limited to ten countries.
Arbitrary questions, live updates, cloud synchronization, city-level exploration, and offline installation are not implemented.
The product remains a short, curiosity-led exploration experience rather than a course or a data dashboard.
