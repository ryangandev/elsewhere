# Prototype verification

This file records release checks, not user acceptance.

## Scope

Verify real browser interactions for direct country selection, search, country focus, overview-to-topic transitions, route overlays, return navigation, zoom, random selection, and mobile reading.
Validate that the globe remains present when a country or a topic is open.
Check keyboard dismissal and the empty search state.

## Known limits

Only eight countries have full editorial coverage.
The map uses simplified Natural Earth boundaries, with a separate selectable Singapore marker.
Illustrative map paths explain a relationship and are not precise navigation routes.
Population values are a dated 2024 reference, not live statistics.
The interface is English-only.
AI conversation is described as a future capability; no model is connected.
The globe needs WebGL; if initialization fails, country stories remain available through the interface.

## Browser checks completed

- Desktop 1440 × 960: all eight profiles opened through search; each exposes three distinct questions.
- Search: an unknown query shows an empty state, and Enter selects a filtered result.
- Singapore: direct selection, contextual neighboring labels, and the shipping topic.
- France: overseas topic widens the camera to show the Atlantic relationship.
- Mobile 390 × 844: no horizontal overflow, map retained above the reading panel, topic shortcut, topic expansion, back, and close.
- Globe: pointer drag changes the visible region; zoom controls respond.
- Browser console: no errors or warnings during the exercised flows.
- TypeScript: `npx tsc --noEmit` passes.
- The 3D engine is lazy-loaded and split into cacheable chunks; its largest linked rendering chunk is about 536 kB before compression, under an explicit 600 kB graphics budget.
- Production build completes successfully; the framework’s route-classification notice is informational.
