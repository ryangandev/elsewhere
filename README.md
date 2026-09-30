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
- The bundled Natural Earth directory contains 258 countries and territories, including real geometry for small countries such as Singapore.
- Country names appear directly on land when there is enough screen space, with additional names revealed by zooming and no permanent point markers.
- Hover a country to reveal its name and filled geographic region; click its shape or visible name to explore it.
- Every map identity has a sourced geographic overview, dated population reference when available, static learning prompts, and nearby editorial destinations.
- English and Simplified Chinese controls, names, search, and country content are available through the header language switch.
- Chinese is the initial language; the browser remembers your choice.
- The ten Chinese editorial overviews and thirty questions are concise adaptations of the English edition, with the same IDs and original sources; full English stories remain available.
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

## Frame-rate checker

The **FPS** button under the globe's zoom controls opens an optional diagnostic panel.
It reports the actual WebGL render callback intervals, with live FPS over approximately two seconds, mean/P95/worst frame time, and frames slower than 33.3 ms.
The **Rotate for 10s** button measures a repeatable automatic rotation and keeps its result visible afterward.
Reset returns to live measurements; Stop retains a partial run.
Closing the panel restores the previous rotation settings and removes the measurement callback and timer.
Each rotation test returns to the camera view captured when the panel opened, so repeated runs share the same starting point.
The **Record drag / zoom for 10s** button records a manual interaction window, including slow frames during movement.
The optional **Compare globe rendering** section switches between the 4K blue globe and vector terrain while keeping the starting view and render resolution unchanged.
It also toggles country labels to check their overhead independently.
Wait for each renderer to settle before starting a run; vector comparison builds its meshes on demand.
Closing the panel always restores the 4K globe and country labels.
A hidden tab interrupts the test and clears live timing so background throttling is not counted as an active-session stall.

The panel updates only itself twice a second and does not run an additional animation loop.
Its figures measure render cadence, not GPU execution time or guaranteed display presentation.
A 60 FPS budget is approximately 16.7 ms per frame; 30 FPS is approximately 33.3 ms.
Draw calls, triangles, render-buffer dimensions, and pixel ratio help compare runs in the same scene and viewport.

## Structure

- `app/page.tsx`: page composition, global controls, dialogs, map focus, and transient feedback.
- `app/ExplorerPanel.tsx`: country overviews, topics, map explanations, sources, and connected stories.
- `app/AtlasDialogs.tsx`: country/question search, trails, and the personal atlas.
- `app/Globe.tsx`: WebGL lifecycle, camera transitions, progressive geometry loading, country selection, and illustrative routes.
- `app/globe/cartography.ts`: screen-space country fit, horizon fading, label priority, and collision avoidance.
- `app/globe/materials.ts`: 4K image material, diagnostic vector terrain, and camera-relative lighting.
- `app/globe/fills.ts`: lazy, merged country caps for hovered and selected regions.
- `app/CountryOverview.tsx`: sourced geographic basics, Chinese editorial précis, and static learning guides.
- `app/locale.tsx`, `app/locale-data.ts`, `app/ui-text.ts`, `app/localized-content.ts`: language persistence, names, interface copy, and localized navigation.
- `app/chinese-content.ts`: Chinese adaptations of the ten edited profiles and thirty existing questions.
- `app/country-basics.json`: Natural Earth Chinese names, geographic regions, and dated population estimates.
- `scripts/build-country-basics.mjs`: rebuild the basics with `npm run maps:basics` from the cached upstream 10m dataset.
- `app/globe/borders.ts`: merged boundary buffers, with separate hovered and selected outlines.
- `app/globe/country-lookup.ts`: bounds-filtered spherical country picking without scene raycasts.
- `app/globe/projection.ts`: constant-time screen-to-sphere intersection for label containment checks.
- `app/exploration.ts`: destination validation, URLs, directory, trails, recommendations, geographic explanations, and search.
- `app/use-atlas.ts`: browser-history integration and validated local persistence.
- `app/data.ts`, `app/other-countries.ts`, `app/southeast-asia.ts`: typed editorial content with permanent topic IDs.
- `app/country-index.json`: compact location directory derived from bundled geometry.
- `scripts/build-country-index.mjs`: regenerate the directory from bundled detailed geometry with `npm run maps:index`.
- `scripts/build-map-assets.mjs`: regenerate geometry, directory, elevation assets, and source hashes with `npm run maps:build`.
- `tests/cartography.test.ts`: geographic coverage, on-land anchors, winding, and country-name containment.
- `tests/exploration.test.ts`: data integrity, URL restoration, trail links, search, location sanity, and persistence validation.

Topic IDs live with their content and do not depend on display titles or ordering.
The selected destination is also the context boundary for a future assistant.
Country anchors use verified Natural Earth label positions, with a largest-polygon fallback and an on-land correction for atolls.
Labels keep readable type sizes and test their center and corners against the actual projected country, rather than shrinking to fit.
Their screen coordinates are converted to geographic coordinates by intersecting a ray with a mathematical sphere.
This avoids scanning the entire country-and-border scene for every label corner; pointer hover and country picking remain separate.
The default 4K globe renders the original Earth image and merged boundary lines.
Only the hovered and selected country receive land-cap fills, with all their islands merged into one mesh per identity.
Caps are built on demand and retained in a bounded sixteen-country cache; new detailed geography invalidates the cache.
Hover and click use the same geographic data as the labels, with a bounds filter before spherical containment.
Hover work pauses during camera movement and drag gestures do not select countries.
Only the diagnostic vector mode builds land-cap meshes; invisible polygon sides remain omitted.
Relevant places within a story use separate contextual labels, while a selected tiny country receives one clear callout.

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

The default globe uses the existing 4096 × 2048 NASA Blue Marble image bundled as `public/maps/earth.jpg`, originally sourced via the three-globe example assets.
It retains the original land colors and blue ocean with bathymetric detail.
The image is a fixed-resolution texture, so extreme zoom cannot reveal new photographic detail.
Country names and boundaries remain independent vector overlays.

Boundaries and country picking use [Natural Earth](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/).
The initial 50m layer is approximately 0.45 MB; zooming closer loads a 1.85 MB layer derived from 10m geography.
Both layers contain the same 258 identities and are topology-simplified with Mapshaper, preserving small shapes.
These are cartographic scales, not metre-level precision.
Merged boundary buffers keep the number of draw calls nearly constant as detailed islands load.
If detailed geography is unavailable, the base boundaries and country picking remain usable.

The FPS comparison retains the vector terrain implementation for local A/B testing.
Its optional relief assets use [NASA Earth Observatory's Blue Marble Next Generation elevation data](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/topography-bathymetry-maps/), derived from GEBCO.
Those elevation assets are not loaded by the default image renderer.

`npm run maps:build` downloads any missing upstream source files to the ignored `.map-sources` cache and regenerates runtime assets.
Keep this cache to reproduce the same inputs; upstream downloads may change over time.
`public/maps/sources.json` records the actual source URLs, input SHA-256 hashes, and processing settings.

Names and boundaries are for exploration and do not endorse territorial claims.
Map paths illustrate relationships and are not exact shipping, river, or historical tracks.

## Verification and scope

See `QA.md` for the exercised browser flows and validation results.
The interface supports English and Simplified Chinese; search recognizes both languages for all 258 map identities.
The directory contains countries and territories, not 258 sovereign states.
Unedited locations expose only bundled Natural Earth facts, their original population year, sources, and static learning guidance.
They do not infer capitals, languages, culture, or current political status.
Full editorial coverage is limited to ten countries.
Arbitrary questions, live updates, cloud synchronization, city-level exploration, and offline installation are not implemented.
The product remains a short, curiosity-led exploration experience rather than a course or a data dashboard.
