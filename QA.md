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

These marker changes are locally implemented and remain uncommitted, following the requested order of committing the second edition before making this adjustment.
