# Prototype verification

This document records local release checks, not production deployment or user acceptance.

## Second edition - 2026-09-27

The second edition adds connected exploration while preserving the globe as the persistent home.
It expands editorial coverage to ten countries and thirty questions.

### Automated validation

- TypeScript passes with `npx tsc --noEmit`.
- ESLint passes with `npm run lint`, with no warnings.
- Seven Node tests pass with `npm test`.
- All thirty topic links round-trip through URL serialization and validation.
- All trail stops and related-story links resolve to actual content.
- The location directory contains unique IDs and finite geographic coordinates.
- Invalid countries return home; invalid topics return to the corresponding country overview.
- Invalid trail associations are dropped rather than displaying a mismatched trail.
- Saved data is validated, deduplicated, and bounded; malformed data cannot break the interface.
- Production build completes successfully.
- Vinext's route-classification notice is informational and remains a framework limitation.

### Desktop browser flows

- All ten country profiles opened through search.
- All thirty questions opened through their country panels and returned to the correct overview.
- Country-name queries prioritize overviews; natural question queries show relevant editorial topics.
- `Why is Singapore so rich?` surfaces the wealth exploration.
- Searching Canada opens its location guide, highlights Canada, and suggests nearby editorial stories.
- Unknown search text shows a useful empty state and allows another search.
- Search opens with input focus; keyboard Enter selects the result.
- The water trail links Singapore, Malaysia, Indonesia, and Turkey while preserving context in the URL.
- Topic geography chips and globe labels focus a place; the explanation offers a return to the full connection.
- Saving a topic persists after refresh and appears in Your atlas.
- The share button confirms a copied link for the current country, topic, and trail.
- Recent exploration lists visited destinations.
- Browser back/forward restores the previous country, topic, and trail.
- Zooming before switching countries no longer replays the old zoom command over the new camera transition.
- The production bundle initializes the globe, renders routes, and restores browser history.
- The production-preview browser reported no console errors or warnings during exercised flows.
- Rebuilding while the local preview was running left stale asset references; restarting the preview restored the globe and current resources.
- The initialization-failure interface kept the story readable during that stale-resource failure, and the final restarted preview loaded successfully.

### Mobile browser flows

Verified at an effective CSS viewport of 390 × 844.

- No horizontal document overflow.
- The globe remains visible above country and topic reading panels.
- The fixed curiosity shortcut reveals the country’s questions.
- Country overview to shipping topic to geographic context works within the existing view.
- The panel can collapse for a larger map and expand to resume reading.
- Search, its empty state, keyboard selection, and country restoration work at this width.

### Reliability improvements

- Missing Natural Earth label coordinates were replaced with a directory derived from actual geometry.
- Topic identities are permanent content IDs rather than title-derived or positional URL identities.
- Camera controls are independent of destination changes.
- Geographic-place focus zooms closer relative to its story view, including already-close island views.
- Map captions and breadcrumbs have contrast-preserving surfaces over bright terrain.
- The renderer caps pixel density and pauses animation while the document is hidden.
- Globe initialization failure retains the reading interface, with a retry affordance.
- Clipboard failure opens a selectable link instead of falsely claiming success.
- Storage failure keeps a session-only library and explains the persistence limit.

The WebGL context-loss, storage-denial, and clipboard-denial recovery branches are implemented but were not forced in the final browser session.
The mobile browser check does not replace testing on a physical phone.

### Local evidence

- `outputs/v2-browser-coverage.json` records the thirty topic titles opened in the browser.
- `outputs/elsewhere-v2-mobile.png` captures the mobile shipping-topic view.
- `outputs/elsewhere-v2-explore.png` captures the production-preview exploration view.

## Known boundaries

The map directory is a simplified selection of countries and territories, not comprehensive political coverage.
Only ten destinations have full editorial profiles.
Search retrieves existing content and does not generate answers.
Population and Indonesia’s capital are dated references.
Bookmarks and history are local to a browser and origin, with no account sync.
Source links and map paths are explained in the interface.
The second edition was committed locally as `38095a4`; it has not been pushed or deployed to the existing private site.

## Country markers - 2026-09-27

Every directory destination now has a white center marker, including places without editorial coverage.
The location and land area come from each country's largest polygon, with Singapore's explicit marker retained.
Large projected land areas show names when there is room; smaller or crowded locations keep a white dot and reveal their names on hover or keyboard focus.
Names adapt to zoom, rotation, and window size, with collision checks between country names.

- Keyboard focus on Nepal reveals the country-name popup; activating it opens Nepal's location guide.
- The overview and closer country view show different name densities without horizontal overflow.
- Country markers remain visible alongside Singapore's contextual water labels and shipping route.
- TypeScript, ESLint, seven existing tests, and the production build pass.

This white-marker iteration was committed locally as `8cc20bc` before beginning the vector-globe replacement below.
It was not pushed or deployed.

## Vector globe and progressive names - 2026-09-27

The white-point iteration is replaced by vector land, adaptive country names, and restrained terrain shading.
This iteration remains a local working-tree change, without push or deployment.

### Automated validation

- TypeScript, ESLint, eleven tests, and the production build pass.
- Both geometry levels contain the same 258 unique country and territory identities.
- All label anchors lie on their own detailed geometry, including Vatican and atolls.
- Country winding, label containment, off-globe rejection, and the mobile collision regression are covered.
- The oversized renderer-chunk warning was eliminated by keeping Three.js imports statically analyzable inside the lazy material module.
- Vinext still prints its informational route-classification notice.

### Browser verification

- The default view shows large-country names without any interaction and has no country dots.
- Zooming into Europe reveals additional names including Austria, Ireland, Italy, and Romania.
- Moving the pointer over Mongolia's land shows its country-name tooltip and highlights its outline; clicking the shape opens Mongolia's location guide.
- France search focuses its actual land and preserves the edited overview and nearby geographic context.
- Timor-Leste remains reachable by search and its existing `?country=tls` URL, with detailed island geometry.
- Singapore's shipping story keeps its route, selected-country callout, and contextual place labels.
- The crowded mobile view now gives the selected country priority, shifts relevant labels slightly where needed, and hides those without safe space.
- Hidden contextual places remain reachable through the reading panel's geography controls.
- Mobile map expansion and story expansion work, with no horizontal document overflow.
- The preview serves base geometry, detailed geometry, and both elevation levels locally.
- No browser rendering errors or warnings appeared during the exercised flows.

Screenshots: `outputs/elsewhere-vector-globe.png` and `outputs/elsewhere-vector-mobile.png`.
The mobile check used an effective CSS width of 390 pixels; a physical phone has not been tested.
The optional-asset failure and WebGL-context-loss branches were not forced in this iteration.
Elevation provides visual shading, not a 3D terrain mesh or satellite imagery.

## Frame-rate diagnostics - 2026-09-27

The FPS control opens a local render-cadence checker with live and retained rotation-test results.
The checker samples the scene's actual render-completion callback and updates only its own React panel twice per second.
It does not change map rendering quality or implement a performance optimization.

- TypeScript, ESLint, fourteen unit tests, and the production build pass.
- The 10-second rotation test completed and retained its measurements after rotation stopped.
- Reset returned to an empty live window and resumed measurement.
- Stopping a second run retained its partial result; closing removed the panel and restored manual globe controls.
- Long stalls remain in the statistics; tests cover elapsed-time FPS, non-60-Hz timing, P95, and slow-frame counts.
- Hidden-tab exclusion and test interruption are implemented but were not forced during this browser check.

### Local baseline

One home-view automatic rotation run on the current machine and in-app browser measured **4.0 FPS**, 250.7 ms mean frame interval, 301.8 ms P95, and 308.8 ms worst interval.
All 40 observed intervals exceeded 33.3 ms over approximately 10 seconds.
The viewport was 751 × 846 CSS pixels, with a 1432 × 808 globe render buffer and DPR 1.8.
The scene reported approximately 2,678 draw calls and 243k triangles.
After the run, the live readout returned to approximately 59-66 FPS while stationary.
A separately stopped 6.9-second run from another orientation measured 7.4 FPS; scene orientation affects the result.
These are local render-cadence samples, not GPU execution timing, a hardware-independent benchmark, or proof of the bottleneck's cause.

Evidence: `outputs/frame-check-baseline.json` and `outputs/elsewhere-fps-check.png`.
The checker remains an uncommitted local change; no push or deployment occurred.

## Rotation bottleneck isolation and repair - 2026-09-27

Two independent sources of wasted work were identified in the vector-globe implementation.
Each label-fit corner previously called `toGlobeCoords`, which raycasts the entire scene recursively before finding the globe intersection.
The label layout now intersects a ray with the mathematical sphere directly, while preserving geographic containment, collision handling, and actual country picking.
The second issue was invisible polygon sides: zero-opacity side materials still generated geometry and transparent draw calls for every island.
An empty side color now omits those sides completely, preserving the land caps, coastlines, borders, and elevation shading while allowing tighter culling bounds.

### Controlled label-lookup comparison

The same session, initial camera view, geometry, materials, and 716 × 405 render buffer were used for both runs.
Both reported 2,678 draw calls and 243k triangles; invisible sides were still enabled at this stage.

| Label lookup | 10-second FPS | Mean interval | P95 interval | Worst interval | Slow intervals |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original scene scan | 3.7 | 271.6 ms | 315.4 ms | 816.3 ms | 37 / 37 |
| Mathematical sphere | 55.7 | 17.9 ms | 20.9 ms | 35.1 ms | 1 / 557 |

The checker can reproduce this comparison through its optional label-calculation selector, and resets to the panel-opening camera view for each run.
Closing the checker restores the optimized mode.
Slow-frame percentages now show one decimal place so a small nonzero count is not displayed as zero percent.

### Normal-resolution and regional checks

Before removing invisible sides, the optimized home-view run measured 43.2 FPS at a 1432 × 808 buffer and DPR 1.8.
Singapore's detailed geometry still measured 16.4 FPS and 77.8 ms P95, with approximately 7,875 draw calls and 658k triangles.
After omitting sides, a Singapore run measured 78.2 FPS and 16.3 ms P95, with zero intervals above 33.3 ms and a 22.1 ms worst interval.
That run used a 1607 × 657 buffer at DPR 2.0, so it is a native-window follow-up rather than the strictly fixed-resolution comparison above.
Its final frame reported approximately 2,360 draw calls and 197k triangles; counts vary with the view as islands are culled.
Returning from Singapore to the world while retaining detailed geometry measured 69.5 FPS, 14.4 ms mean, 20.2 ms P95, and 30.0 ms worst interval with zero slow frames.
This final run used a 1578 × 892 buffer at DPR 2.0 and reported 4,468 draw calls and 226k triangles.

### Validation and limits

TypeScript, ESLint, all sixteen tests, and the production build pass.
New tests verify sphere lookup over rotated, zoomed, dateline, and polar views, and reject off-globe and invalid-viewport points.
The performance panel is portaled outside the globe's mask so its controls remain visible and usable above the country reading panel.
The final browser check confirmed readable progressive names in the home view, intact Singapore coastlines and story labels, and no captured browser errors or warnings.
These local render-cadence measurements are not GPU execution timings or a guarantee of 60 FPS on every device.
Physical phones, sustained thermal load, and the optional-asset failure paths were not tested in this iteration.

Evidence: `outputs/projection-ab-original.json`, `outputs/projection-ab-optimized.json`, `outputs/projection-native-optimized.json`, `outputs/projection-regional-optimized.json`, and `outputs/projection-regional-final.json`.
Final world-view evidence: `outputs/projection-world-final.json` and `outputs/elsewhere-globe-performance-fixed.png`.
The fixes are running locally and remain uncommitted, without push or deployment.

## Blue globe restoration with independent labels - 2026-09-27

Ryan preferred the previous blue image-based globe and reported intermittent slowdowns while zoomed in.
The existing 4096 × 2048 `earth.jpg` is now the default base map again.
Progressive country names, geographic containment, collision handling, selected-country callouts, contextual labels, and topic routes remain independent of the image.
Country borders are merged into one line buffer, with one additional buffer each for selected and hovered outlines.
Image mode does not render country land meshes or load elevation-shading images.
Pointer identification uses sphere intersection and bounds-filtered geographic containment, pauses hover work during movement, and distinguishes drags from country clicks.

### Reproduction and controlled comparison

Before this change, a zoomed vector-globe run measured 30.3 FPS, 53.2 ms P95, and 153 slow intervals out of 303.
A subsequent live drag sample showed 34.7 FPS and 27.1% slow intervals.
This reproduction is captured separately because its viewport and camera differ from the controlled comparison below.

The A/B runs below used the same renderer instance, 1360 × 1209 buffer at DPR 1.8, initial latitude 1.35, longitude 103.82, and altitude 0.318.
Detailed geography was loaded before testing, and each automatic run reset to the same initial camera view.
The vector comparison preserves its optimized label lookup and omits invisible polygon sides from the previous iteration.

| Configuration | 10-second FPS | P95 interval | Worst interval | Slow intervals >33.3 ms |
| --- | ---: | ---: | ---: | ---: |
| Vector terrain, labels on | 58.1 | 29.2 ms | 46.7 ms | 15 (2.6%) |
| 4K blue globe, labels on | 120.0 | 10.7 ms | 12.6 ms | 0 |
| 4K blue globe, country labels off | 120.0 | 9.5 ms | 15.9 ms | 0 |
| 4K blue globe, labels on, manual interaction window | 119.9 | 9.4 ms | 17.2 ms | 0 |

The manual window included four drag gestures, one zoom-in action, one zoom-out action, and intervals between these inputs.
It is not a claim of ten seconds of uninterrupted pointer motion.
A European follow-up at latitude 46.60, longitude 2.50, altitude 0.532 included six drag gestures and zoom in/out actions during recording.
It measured 119.2 FPS, 10.9 ms P95, and 27.9 ms worst interval, with no intervals above 33.3 ms; see `outputs/blue-globe-europe-manual.json`.
Closing the checker restores the 4K globe and country labels.
Its rendering selector preserves the camera, dimensions, and pixel ratio, and its new manual recording button retains interaction results for inspection.
Vector mode builds its country meshes on demand and may briefly stall during switching; that diagnostic setup cost is excluded by waiting before starting a run.

### Verification and boundaries

All eighteen tests, TypeScript, ESLint, and the production build pass.
New country-lookup tests identify every one of the 258 detailed-geometry label anchors, including tiny islands and dateline countries, and reject open-water and off-globe points.
Direct shape hovering identifies China and outlines it; clicking the same land opens China's overview.
Dragging preserves the currently selected country instead of treating a drag release as a click.
France search and map expansion retain readable country names and contextual geography labels; zoom reveals additional names such as Italy.
Singapore's shipping story retains its selected-country callout, geographic labels, and route overlay on the restored image.
The 4K image has finite detail and does not gain photographic resolution on extreme zoom.
These are local render-cadence results on this machine, not GPU timings or a universal 120 FPS guarantee.
The fixed-rate ceiling also means the label comparison cannot establish zero computational overhead.
Physical-phone and sustained thermal-load testing remain unverified.

Evidence: `outputs/texture-recheck-vector-baseline.json`, `outputs/blue-globe-close-vector.json`, `outputs/blue-globe-close-labels-on.json`, `outputs/blue-globe-close-labels-off.json`, and `outputs/blue-globe-close-manual.json`.
This restoration is a local working-tree change; no commit, push, or deployment occurred.

## Bilingual country coverage and region fills - 2026-09-30

This iteration remains local, with the development preview at `http://localhost:8787/`.
At local validation time, the existing working tree and HEAD `8cc20bc` were retained; no commit, push, merge, or deployment had been performed.

### Coverage and content

All 258 Natural Earth country and territory identities have Chinese names, geographic regions, map anchors, source links, and expandable static learning guides.
These are cartographic identities, not 258 sovereign countries.
Basic population references preserve the bundled source's own year, rather than presenting historical estimates as live figures.
The ten curated Chinese overviews retain the edition's 2024 population reference and original editorial source links.
All thirty existing editorial questions have Chinese précis with unchanged country/topic IDs.
Chinese question views explicitly identify their content as a concise adaptation and offer the complete English edition through the language switch.
Unedited locations explicitly disclose the absence of a deeper editorial story and avoid inferred capitals, languages, culture, or political status.

English and Simplified Chinese apply to controls, country names, region names, search results, reading views, trails, and the library.
The visible header switch preserves the destination and camera and remembers the browser's choice.
Country names are searched in both languages regardless of the selected interface language.

### Browser checks

- Chinese search for Germany opens its sourced basic overview, population year, and expandable location guide.
- Directly clicking China's land opens the existing overview; small Singapore remains searchable and selectable.
- With Kazakhstan selected, hovering Russia shows its filled territory, separate border, and localized tooltip while preserving Kazakhstan's overview.
- Switching the Singapore shipping question between Chinese and English preserves its URL, map route, and sources.
- The Chinese water trail navigates from Singapore to Malaysia, and browser back restores the exact previous country/question/trail URL.
- Saving and reading a Chinese question in the library works; the test bookmark was removed afterward.
- English survives a reload, and the final preview is left in Chinese.
- A narrow mobile viewport retains the language switch, readable overview, and collapsed map exploration mode; the temporary viewport override was reset.
- A fresh final browser tab reported no console warnings or errors.

Dragging over a country-name button previously triggered its click handler and could navigate unexpectedly.
The label now compares press and release positions before navigating, while preserving keyboard activation.
The final browser check dragged across Russia's label and retained Kazakhstan's destination.

Evidence screenshot: `outputs/bilingual-country-hover.jpg`.

### Rendering and validation

The 4K image, throttled picking, merged borders, adaptive labels, detailed geography, and diagnostic vector comparison remain available.
Hovered and selected caps are lazy, merged country meshes, including islands and polygon holes.
At most two fill meshes are visible, and a bounded sixteen-country cache limits retained geometry.
Geometry refinement invalidates and disposes prior caps.
A first visit to an uncached country still requires cap construction; steady-state figures do not measure that one-time setup cost.

The initial 10-second rotation check measured 119.7 FPS and 12.2 ms P95 on this machine, with one interval above 33.3 ms.
The first polygon-per-island fill implementation used 93 draw calls while Kazakhstan was selected and Russia hovered.
The merged implementation reduced that same scene to seven draw calls; the observed recent-two-second snapshot was approximately 120 FPS and 9.1 ms P95.
These measure local WebGL render cadence, not GPU execution time or guaranteed performance on other hardware.

All 22 tests, TypeScript, ESLint, and the production build pass.
New tests cover every bilingual map identity, all thirty Chinese questions, URL identity retention, island-rich fill draw bounds, spherical cap geometry, tiny-country filling, and cache invalidation on refinement.
Physical-phone and sustained thermal-load testing remain unverified.
