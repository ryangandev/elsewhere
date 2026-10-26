# Architecture

This describes the **target** architecture that the codebase is being migrated to.
Until the migration in [Migration plan](#migration-plan) is finished, the code still follows the prototype layout described in `README.md`.
Each subsystem section says what it does, why it is built this way, and what can go wrong.

## Overview

The product is a static, content-driven site with one persistent interactive globe.

```text
content pipeline (offline)          site (static, Next.js)
--------------------------          -------------------------------------------
sources + Claude + geo data   -->   content/en/*.json  -->  pages  -->  reading panel
        |                                  |                   \
   validation gate                    search index              MapScene --> globe controller
```

The central contract is the **content schema**.
The pipeline produces it, the site renders it, and a future live-answer service will produce the same shape.
The globe never knows where content came from; it only renders a `MapScene`.

## Code map

```text
app/                       Next.js routes; the root layout owns the persistent globe
  layout.tsx
  page.tsx                 home: question input, starter questions
  [country]/page.tsx       country overview
  [country]/[story]/page.tsx  one answered question
src/
  content/                 schema (zod), typed loaders, provenance helpers
  domain/                  navigation, search, recommendations, library
  globe/                   framework-free globe controller and its parts
  ui/                      React components
  i18n/                    message catalog (English only for now)
content/en/                generated and reviewed content, one file per country
data/geo/                  Natural Earth derived map identities and gazetteer
pipeline/                  content generation (step 5)
scripts/                   geo data builds and content:check
tests/                     unit tests; e2e/ for Playwright
```

## Platform

Next.js App Router with static generation, deployed as a static site on Vercel.

Why:

- Every country and question gets a real path (`/singapore/shipping`) that is prerendered.
  Shared links get proper titles and preview images, and search engines can index the content.
  This matters for a portfolio piece that people will share.
- The root layout persists across navigations, so the globe is created once and never remounts.
- Stage 2 needs server code (live answers, accounts).
  Next.js route handlers add that without changing frameworks.

What changes from the prototype:

- `vinext` (a beta reimplementation of Next.js on Vite) is replaced by Next.js itself.
- The ChatGPT Sites and Cloudflare Worker template, D1/drizzle scaffolding, and unused shadcn components are removed.
- Query-string URLs (`/?country=sgp&topic=shipping`) redirect to path URLs.

## Content model

Content lives in `content/<locale>/`, validated against a zod schema in `src/content/schema.ts`.
The loaders parse every file on first use, so a file that fails validation fails the build.
`npm run content:check` and the content tests run the same schema plus the checks a schema cannot express.

```text
content/en/countries/<slug>.json   { country: Country, stories: Story[] } for one country
content/en/trails.json             Trail[]
content/en/places.json             { [placeId]: note }, editorial notes shown on map places
```

Core shapes:

```text
Country     id, slug, name, nativeName?, region, kicker, overview, quickFacts[],
            starterStoryIds[] (3 to 5), scene: SceneSpec, sources[], provenance
Overview    summary, geography, sourceIds[], whyItMatters[{title, text, sourceIds[]}]
QuickFact   label, value, asOf?, sourceIds[]
Story       id, countryId, slug, question, category, summary,
            sections[{title, text, sourceIds[]}], takeaway, scene: SceneSpec,
            next: StoryRef[] (max 3), sources[], provenance
StoryRef    countryId, storyId, reason? (required when the story is in another country)
SceneSpec   camera?, focusCountryId, highlights[{countryId, role}], placeIds[], routes[], mapNote?
Route       id, kind: sea | land | river | flow, via: placeId[] (2 or more)
Source      id, title, publisher, url (https), accessedAt?
Provenance  generatedBy ("human" or a model ID), generatedAt, reviewedBy?, reviewedAt?,
            status: draft | reviewed
Trail       id, title, label, description, stops[{countryId, storyId, connection}]
```

Content stores a `SceneSpec`, which only names places.
`resolveScene(spec)` turns it into the globe's `MapScene`: coordinates from the gazetteer, notes from `places.json`, and route polylines along great circles.
Place notes are locale text, so they live in content rather than in the generated gazetteer.

Rules:

- Story and country IDs are permanent and never derived from titles or order.
  Every cross-reference uses IDs, never array positions.
  Country IDs are the ISO 3166 alpha-3 codes of the map identities in `data/geo/countries.json`; story IDs are unique within a country.
- Slugs are readable URL segments and may change; IDs may not.
  A country's slug must match its map identity, and its file is named after the slug so content paths match URLs.
- Every section, overview item and quick fact lists the source IDs that support it, and every declared source is cited.
- `placeIds` and route `via` lists reference gazetteer IDs; coordinates are looked up from `data/geo`, never written by hand or by the model.
- `sea` routes must stay at sea (see [Content pipeline](#content-pipeline)).
  `land` and `river` routes follow their named places.
  `flow` routes are illustrative arcs for a relationship such as trade or language, and are not checked against land.
- Each story leads to at least one next question in the same country and one elsewhere.
- Generated content records when each source was read (`accessedAt`); content converted by hand (`generatedBy: "human"`) may omit it.
- Only `reviewed` content is built into production.
  In production the loaders drop drafts and every starter question, next question and trail stop that points at one; development shows drafts.
- Locale is a directory, so a Chinese edition is a parallel `content/zh/` tree with the same IDs.

Loaders in `src/content/index.ts` are synchronous and free of Node APIs, so they work in server components and in the browser:
`getCountry(id or slug)`, `listCountries`, `getStory`, `getStoryBySlug`, `listStories`, `listTrails`, `getPlaceNote`, `getMapCountry` (all 258 map identities, edited or not) and `resolveScene`.
Files reach the loaders through static imports in `src/content/registry.ts`; `content:check` fails when a file is not registered.

Why: the prototype keyed Chinese text by array index and spread translations across five mechanisms.
One schema, ID-only references, and locale-as-directory remove both problems.

## Content pipeline

Offline scripts in `pipeline/` that produce draft content for review.

1. **Research and draft.**
   For a country or question, Claude (with web search) drafts a structured `Story` or `Country` and the sources it relied on.
   Output is constrained to the schema.
2. **Validate.**
   Schema check, every source URL resolves, every section cites at least one source, every place ID exists in the gazetteer, and every sea route stays at sea.
   Everything except URL reachability already runs as `npm run content:check` (`scripts/validate-content.ts`, rules in `src/content/validate.ts`); the URL check arrives with the generation step.
3. **Review.**
   Ryan reads and edits the draft, then marks it `reviewed`.
   Review records who and when in `provenance`.
4. **Commit.**
   Reviewed JSON is committed like code; git history is the content history.

Coverage grows in batches: a pilot batch to tune prompts and the review bar, then expansion.

Geo data in `data/geo/` is generated from Natural Earth 10m datasets, which are cached in `.map-sources/` and recorded with URL and SHA-256 in `data/geo/sources.json`:

- `countries.json` (`npm run maps:countries`) holds all 258 map identities: ID, slug, English name, region, population and label anchor.
- `gazetteer.json` (`npm run maps:gazetteer`) holds about 1,250 named places (37 KB gzipped): every country, named seas and straits, major rivers, physical regions, and major cities and capitals.
  IDs are slugs of the English name; when two kinds share a name, the lower-priority one gets a suffix, so `singapore` is the country and `singapore-city` the city.
- `gazetteer-overrides.json` is the only hand-maintained input: a short list of extra Natural Earth features to include, renames to common English names, and the few features Natural Earth lacks.
  Added features are anchored to Natural Earth geometry, never to typed coordinates, and every entry gives a reason.

Sea routes are checked against `public/maps/countries-detail.geojson`, the detailed geometry the globe draws; the base geometry's coarser coastlines close narrow straits such as the Bosporus.

- Every sea place has a label point that is at sea in that geometry.
  A water body whose polygon is entirely covered by simplified land is dropped (currently only the Luzon Strait).
- Straits and channels also get a passage `path` along their long axis.
  A route through a strait follows the path, because a single label point inside a winding strait forces the line across a shore.
- A route is sampled along great circles every 2 km.
  Land within 50 km of a land waypoint (a port) is allowed, and crossings of 15 km or less are ignored, so small islands do not fail a route.

What can go wrong:

- Model-written coordinates and routes are often wrong, for example a "sea route" drawn across a peninsula.
  This is why places come from the gazetteer and routes are checked against land polygons.
- Ocean label points sit in the middle of the ocean, far from most scenes.
  Prefer the nearest marginal sea (the Philippine Sea rather than the Pacific) when a story means the water off a coast.
- A URL that resolves does not prove it supports the claim.
  Review remains necessary; the pipeline only removes mechanical errors.

## Globe

A framework-free controller in `src/globe/` with a thin React wrapper.

```text
const globe = createAtlasGlobe(container, { geometry, labels })
globe.setScene(scene)     // camera, focus, highlights, places, routes
globe.on('select', id)    // country clicked
globe.zoom('in' | 'out' | 'reset')
globe.dispose()
```

Why:

- The prototype kept all globe logic inside one large React effect and passed functions between effects through refs.
  A plain class with explicit methods is easier to read, test, and reuse.
- React state describes *what* to show (`MapScene`); the controller decides *how* to animate and render it.
- Labels are created once and updated in place, instead of being rebuilt on every navigation.

Kept from the prototype, because each was measured or verified:

- The 4K image basemap with merged border buffers, rather than vector land meshes.
- Progressive country labels with screen-space fit and collision checks.
- Sphere-intersection picking with bounds filtering, instead of scene raycasts.
- Lazy, merged fill caps for hovered and selected countries, with a bounded cache.
- Base geometry first, detailed geometry when zoomed in.

Removed: the vector terrain mode, relief textures, and the FPS diagnostic panel.
They were investigation tools, not product features, and they remain in git history.

## Discovery and navigation

- Paths are the source of truth for the current destination: `/`, `/<country>`, `/<country>/<story>`.
- Starter questions and next questions come from content (`starterStoryIds`, `next`), not from hardcoded maps in code.
- Search runs on a build-time index of countries and questions, loaded on demand in the browser.
- Bookmarks and recent history stay in localStorage, behind a small `library` interface so Stage 2 can add sync.

## Internationalization

English only in Stage 1.
Interface strings go through a typed message catalog in `src/i18n/` keyed by stable message IDs, not by English text.
Adding Chinese later means adding a catalog and a `content/zh/` tree, with no component changes.

## Testing

- Unit tests (Vitest) for pure logic: schema rules, navigation, search, cartography, picking.
- Content validation runs in CI on every change to `content/`.
- Playwright e2e covers the core loop: ask, read, follow a next question, bookmark, share, back and forward, mobile layout.

## Migration plan

Each step is one PR and leaves the site working.

1. **Docs and cleanup.** Agent docs, remove template leftovers and diagnostic features, add Prettier and CI.
2. **Platform.** Move to Next.js with path routes and the globe in the root layout; English default.
3. **Content schema.** Define the schema and convert the ten existing profiles to JSON; drop the Chinese précis.
4. **Globe controller.** Extract the controller and drive it with `MapScene`.
5. **Pipeline.** Generation, validation, and geo checks; produce a pilot batch for review.
6. **Question-first experience.** Home question input, starter and next questions, search over the question bank.
7. **Scale and ship.** Expand reviewed coverage, e2e tests, public portfolio deployment.
