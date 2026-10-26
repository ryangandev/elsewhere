// Builds the view models pages hand to client components. Runs on the server at build time:
// it reads content and the gazetteer, resolves scenes, and turns IDs into paths, so the browser
// receives only what one page renders. See docs/architecture.md#server-and-client-boundary.
import 'server-only';
import {
  getCountry,
  getMapCountry,
  getPlace,
  getStory,
  listCountries,
  listMapCountries,
  listStories,
  listTrails,
  resolveScene,
  type Country,
  type MapCountry,
  type Provenance,
  type SceneSpec,
  type Source,
  type Story,
  type StoryRef,
  type Trail,
} from '@/content';
import type { MapScene } from '@/globe/scene';
import { destinationKey, type Destination } from './destination';
import { destinationPath } from './paths';
import { countryFromSegment, storyFromSegment } from './slugs';
import type {
  CountryPageView,
  HomeView,
  MapCountryPageView,
  MapView,
  PageView,
  PlaceView,
  ProvenanceView,
  ShellPage,
  SourceView,
  StoryLinkView,
  StoryPageView,
  TrailView,
} from './view-models';

/** Edited countries the home view begins with, until the question-first home replaces it. */
const HOME_PICK_IDS = ['SGP', 'JPN', 'BRA', 'TUR'];
const HOME_PICK_COUNT = 4;
const NEARBY_COUNT = 3;
const CONNECTION_COUNT = 3;

/** The emoji flag for an ISO 3166 alpha-2 code: two regional indicator symbols. */
export function flagEmoji(isoA2: string | null): string {
  if (!isoA2 || !/^[A-Z]{2}$/.test(isoA2)) return '';
  return String.fromCodePoint(...[...isoA2].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

function requireMapCountry(countryId: string): MapCountry {
  const country = getMapCountry(countryId);
  if (!country) throw new Error(`Unknown map country "${countryId}"`);
  return country;
}

/** The display name: an edited country's editorial name, else its map name. */
export function countryName(countryId: string): string {
  return getCountry(countryId)?.name ?? requireMapCountry(countryId).name;
}

export function countryFlag(countryId: string): string {
  return flagEmoji(requireMapCountry(countryId).isoA2);
}

/** A card linking to a country overview. */
export function countryLink(countryId: string, caption?: string): StoryLinkView {
  const profile = getCountry(countryId);
  const destination = { countryId };
  return {
    key: destinationKey(destination),
    href: destinationPath(destination),
    flag: countryFlag(countryId),
    countryName: countryName(countryId),
    title: profile?.kicker ?? countryName(countryId),
    ...(caption ? { caption } : {}),
  };
}

/** A card linking to one question, optionally as a stop on a trail. */
export function storyLink(destination: Destination, caption?: string): StoryLinkView {
  const story = destination.storyId && getStory(destination.countryId, destination.storyId);
  if (!story) throw new Error(`Unknown story "${destinationKey(destination)}"`);
  return {
    key: destinationKey(destination),
    href: destinationPath(destination),
    flag: countryFlag(destination.countryId),
    countryName: countryName(destination.countryId),
    category: story.category,
    title: story.question,
    ...(caption ? { caption } : {}),
  };
}

function refLink(ref: StoryRef): StoryLinkView {
  return storyLink({ countryId: ref.countryId, storyId: ref.storyId }, ref.reason);
}

function sourceViews(sources: Source[], ids?: string[]): SourceView[] {
  const selected = ids ? ids.map((id) => sources.find((source) => source.id === id)) : sources;
  return selected
    .filter((source): source is Source => !!source)
    .map(({ id, title, publisher, url }) => ({ id, title, publisher, url }));
}

function provenanceView(provenance: Provenance): ProvenanceView {
  return {
    aiAssisted: provenance.generatedBy !== 'human',
    status: provenance.status,
    ...(provenance.reviewedAt ? { reviewedAt: provenance.reviewedAt } : {}),
  };
}

function placeViews(scene: MapScene): PlaceView[] {
  return scene.places.map((place) => {
    const countryId = place.kind === 'country' ? getPlace(place.id)?.countryId : undefined;
    return {
      id: place.id,
      name: place.name,
      ...(place.note ? { note: place.note } : {}),
      ...(countryId && getMapCountry(countryId)
        ? { country: { name: countryName(countryId), href: destinationPath({ countryId }) } }
        : {}),
    };
  });
}

function mapView(spec: SceneSpec, scene: MapScene, note: string): MapView {
  return { note, places: placeViews(scene), hasRoute: spec.routes.length > 0 };
}

function shellPage(destination: Destination, scene: MapScene): ShellPage {
  return {
    destination: {
      key: destinationKey(destination),
      countryId: destination.countryId,
      countryName: countryName(destination.countryId),
      countryHref: destinationPath({ countryId: destination.countryId }),
      href: destinationPath(destination),
      ...(destination.storyId ? { storyId: destination.storyId } : {}),
    },
    scene,
  };
}

function pageCountry(countryId: string, region: string) {
  const map = requireMapCountry(countryId);
  return {
    id: countryId,
    name: countryName(countryId),
    href: destinationPath({ countryId }),
    region,
    lat: map.lat,
    lng: map.lng,
  };
}

/** The overview page for any map identity: edited content when it exists, map basics otherwise. */
export function buildCountryPage(countryId: string): CountryPageView | MapCountryPageView {
  const profile = getCountry(countryId);
  return profile ? editedCountryPage(profile) : mapCountryPage(requireMapCountry(countryId));
}

function editedCountryPage(profile: Country): CountryPageView {
  const scene = resolveScene(profile.scene);
  const stories = listStories(profile.id);
  const starterIds = new Set(profile.starterStoryIds);
  const link = (story: Story) => storyLink({ countryId: profile.id, storyId: story.id });

  return {
    kind: 'country',
    shell: shellPage({ countryId: profile.id }, scene),
    title: profile.name,
    flag: countryFlag(profile.id),
    country: pageCountry(profile.id, profile.region),
    ...(profile.nativeName ? { nativeName: profile.nativeName } : {}),
    kicker: profile.kicker,
    summary: profile.overview.summary,
    quickFacts: profile.quickFacts.map(({ label, value, asOf }) => ({
      label,
      value,
      ...(asOf ? { asOf } : {}),
    })),
    whyItMatters: profile.overview.whyItMatters.map(({ title, text }) => ({ title, text })),
    map: mapView(profile.scene, scene, profile.overview.geography),
    starters: profile.starterStoryIds
      .map((storyId) => stories.find((story) => story.id === storyId))
      .filter((story): story is Story => !!story)
      .map(link),
    moreQuestions: stories.filter((story) => !starterIds.has(story.id)).map(link),
    connections: countryConnections(profile, stories),
    sources: sourceViews(profile.sources),
    provenance: provenanceView(profile.provenance),
  };
}

/**
 * Questions elsewhere that this country's questions lead to, starter questions first.
 * They come from the stories' own `next` references, so they always carry a reason.
 */
function countryConnections(profile: Country, stories: Story[]): StoryLinkView[] {
  const ordered = [
    ...profile.starterStoryIds.flatMap((id) => stories.filter((story) => story.id === id)),
    ...stories.filter((story) => !profile.starterStoryIds.includes(story.id)),
  ];
  const refs = ordered.flatMap((story) => story.next).filter((ref) => ref.countryId !== profile.id);
  const unique = refs.filter(
    (ref, index) =>
      refs.findIndex((other) => destinationKey(other) === destinationKey(ref)) === index,
  );
  return unique.slice(0, CONNECTION_COUNT).map(refLink);
}

/** Great-circle closeness of two points (haversine term; smaller is closer). */
function closeness(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  return (
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2
  );
}

/** The edited countries closest to a map identity, by label anchor. */
export function nearbyEditedCountries(countryId: string, count = NEARBY_COUNT): string[] {
  const origin = requireMapCountry(countryId);
  return listCountries()
    .filter((country) => country.id !== countryId)
    .map((country) => ({
      id: country.id,
      distance: closeness(origin, requireMapCountry(country.id)),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((item) => item.id);
}

function mapCountryPage(country: MapCountry): MapCountryPageView {
  const scene: MapScene = { focusCountryId: country.id, highlights: [], places: [], routes: [] };
  return {
    kind: 'map',
    shell: shellPage({ countryId: country.id }, scene),
    title: country.name,
    flag: flagEmoji(country.isoA2),
    country: pageCountry(country.id, country.region),
    population:
      country.population !== null && country.populationYear !== null
        ? { value: country.population, year: country.populationYear }
        : null,
    nearby: nearbyEditedCountries(country.id).map((id) => countryLink(id)),
  };
}

/** The page for one question. */
export function buildStoryPage(countryId: string, storyId: string): StoryPageView {
  const story = getStory(countryId, storyId);
  if (!story) throw new Error(`Unknown story "${countryId}/${storyId}"`);
  const profile = getCountry(countryId)!;
  const scene = resolveScene(storySceneSpec(story, profile));
  const destination = { countryId, storyId };

  return {
    kind: 'story',
    shell: shellPage(destination, scene),
    title: story.question,
    flag: countryFlag(countryId),
    country: pageCountry(countryId, profile.region),
    storyId,
    category: story.category,
    summary: story.summary,
    map: mapView(story.scene, scene, story.scene.mapNote),
    sections: story.sections.map((section) => ({
      title: section.title,
      text: section.text,
      sources: sourceViews(story.sources, section.sourceIds),
    })),
    takeaway: story.takeaway,
    next: story.next.map(refLink),
    trails: listTrails()
      .filter((trail) =>
        trail.stops.some((stop) => destinationKey(stop) === destinationKey(destination)),
      )
      .map(trailView),
    sources: sourceViews(story.sources),
    provenance: provenanceView(story.provenance),
  };
}

/**
 * A question's scene. Without its own camera it keeps its country's camera, so a question
 * opens on the same view as its overview; only a scene with neither falls back to the globe's
 * framing of the focus country, which dives very close on a small country such as Singapore.
 */
export function storySceneSpec(story: Story, profile: Country): SceneSpec {
  if (story.scene.camera || !profile.scene.camera) return story.scene;
  if (story.scene.focusCountryId !== profile.scene.focusCountryId) return story.scene;
  return { ...story.scene, camera: profile.scene.camera };
}

export function trailView(trail: Trail): TrailView {
  return {
    id: trail.id,
    title: trail.title,
    label: trail.label,
    description: trail.description,
    stops: trail.stops.map((stop) =>
      storyLink(
        { countryId: stop.countryId, storyId: stop.storyId, trailId: trail.id },
        stop.connection,
      ),
    ),
  };
}

export function buildHomeView(): HomeView {
  const edited = listCountries();
  const picks = [
    ...HOME_PICK_IDS.filter((id) => edited.some((country) => country.id === id)),
    ...edited.map((country) => country.id).filter((id) => !HOME_PICK_IDS.includes(id)),
  ].slice(0, HOME_PICK_COUNT);
  return {
    picks: picks.map((id) => countryLink(id)),
    surprise: edited.map((country) => ({
      countryId: country.id,
      href: destinationPath({ countryId: country.id }),
    })),
  };
}

export type PageSummary = { title: string; description: string };

/** The title and description of a page, for metadata and link previews. */
export function describePage(view: PageView): PageSummary {
  switch (view.kind) {
    case 'story':
      return { title: view.title, description: view.summary };
    case 'country':
      return { title: view.title, description: view.summary };
    case 'map':
      return {
        title: view.title,
        description: `${view.title} in ${view.country.region}: where it is on the map, with Natural Earth basics and the edited stories nearby.`,
      };
  }
}

/** The page a `/<country>` path shows, or undefined when it is not a country on the map. */
export function matchCountryRoute(
  segment: string,
): CountryPageView | MapCountryPageView | undefined {
  const countryId = countryFromSegment(segment);
  return countryId ? buildCountryPage(countryId) : undefined;
}

/** The page a `/<country>/<story>` path shows, or undefined when it is not a question. */
export function matchStoryRoute(
  countrySegment: string,
  storySegment: string,
): StoryPageView | undefined {
  const countryId = countryFromSegment(countrySegment);
  const storyId = countryId && storyFromSegment(countryId, storySegment);
  return countryId && storyId ? buildStoryPage(countryId, storyId) : undefined;
}

/** Every country page: all map identities, edited or not. */
export function countryStaticParams(): { country: string }[] {
  return listMapCountries().map((country) => ({ country: country.slug }));
}

/** Every question page. */
export function storyStaticParams(): { country: string; story: string }[] {
  return listStories().map((story) => {
    const [, country, storySegment] = destinationPath({
      countryId: story.countryId,
      storyId: story.id,
    }).split('/');
    return { country, story: storySegment };
  });
}
