import { describe, expect, it } from 'vitest';
import { getCountry, getHome, getStory, listCountries, listStories } from '@/content';
import { buildAtlasIndex, buildCountryLabels } from '@/domain/client-indexes';
import {
  buildCountryPage,
  buildHomeView,
  buildStoryPage,
  describePage,
  flagEmoji,
  nearbyEditedCountries,
  storySceneSpec,
} from '@/domain/page-views';

/** View models cross the server and client boundary, so they must survive JSON unchanged. */
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('story page', () => {
  const view = buildStoryPage('SGP', 'shipping');

  it('carries what to read, with each section citing its sources', () => {
    expect(view.kind).toBe('story');
    expect(view.title).toBe('Why is Singapore a shipping crossroads?');
    expect(view.flag).toBe('🇸🇬');
    expect(view.country).toMatchObject({ id: 'SGP', name: 'Singapore', href: '/singapore' });
    expect(view.sections.length).toBeGreaterThan(0);
    for (const section of view.sections) {
      expect(section.sources.length).toBeGreaterThan(0);
      for (const source of section.sources) expect(source.url).toMatch(/^https:\/\//);
    }
    expect(view.provenance).toEqual({
      aiAssisted: false,
      status: 'reviewed',
      reviewedAt: '2026-09-27',
    });
    expect(roundTrip(view)).toEqual(view);
  });

  it('publishes a resolved scene with the route at sea and labelled places', () => {
    const { scene, destination } = view.shell;
    expect(destination).toEqual({
      key: 'SGP:shipping',
      countryId: 'SGP',
      countryName: 'Singapore',
      countryHref: '/singapore',
      storyId: 'shipping',
      href: '/singapore/shipping',
    });
    expect(scene.focusCountryId).toBe('SGP');
    expect(scene.routes).toHaveLength(1);
    expect(scene.routes[0].kind).toBe('sea');
    expect(scene.routes[0].points.length).toBeGreaterThan(10);
    expect(view.map.hasRoute).toBe(true);
    expect(view.map.note).toBe(getStory('SGP', 'shipping')!.scene.mapNote);
    expect(view.map.places.map((place) => place.id)).toEqual(scene.places.map((place) => place.id));
    const malaysia = view.map.places.find((place) => place.id === 'malaysia');
    expect(malaysia?.country).toEqual({ name: 'Malaysia', href: '/malaysia' });
  });

  it('frames a story without its own camera like its country page', () => {
    const story = getStory('SGP', 'shipping')!;
    const country = getCountry('SGP')!;
    expect(story.scene.camera).toBeUndefined();
    expect(storySceneSpec(story, country).camera).toEqual(country.scene.camera);

    const ownCamera = { lat: 0, lng: 100, altitude: 2 };
    const framed = { ...story, scene: { ...story.scene, camera: ownCamera } };
    expect(storySceneSpec(framed, country).camera).toEqual(ownCamera);

    const elsewhere = { ...story, scene: { ...story.scene, focusCountryId: 'MYS' } };
    expect(storySceneSpec(elsewhere, country).camera).toBeUndefined();
  });

  it('offers at most three next questions, same place first, with reasons for those elsewhere', () => {
    expect(view.next.length).toBeGreaterThan(0);
    expect(view.next.length).toBeLessThanOrEqual(3);
    expect(view.next[0]).toMatchObject({ relation: 'deeper', countryName: 'Singapore' });
    expect(view.next.some((link) => link.relation === 'elsewhere')).toBe(true);
    for (const link of view.next) {
      expect(link.relation).toBe(link.countryName === 'Singapore' ? 'deeper' : 'elsewhere');
      if (link.relation === 'elsewhere') expect(link.caption).toBeTruthy();
    }
    expect(view.next.map((link) => link.href)).toContain('/malaysia/two-shores');
  });

  it('includes the trails it is a stop on, with trail links', () => {
    expect(view.trails.map((trail) => trail.id)).toEqual(['water-connects']);
    const [first, second] = view.trails[0].stops;
    expect(first.href).toBe('/singapore/shipping?trail=water-connects');
    expect(first.caption).toBeTruthy();
    expect(second.countryName).toBe('Malaysia');
    expect(buildStoryPage('SGP', 'wealth').trails).toEqual([]);
  });

  it('builds for every question and describes it', () => {
    for (const story of listStories()) {
      const page = buildStoryPage(story.countryId, story.id);
      expect(describePage(page)).toEqual({ title: story.question, description: story.summary });
    }
  });
});

describe('country page', () => {
  it('leads an edited country with its starter questions and content facts', () => {
    const view = buildCountryPage('SGP');
    if (view.kind !== 'country') throw new Error('expected an edited country');
    expect(view.nativeName).toBe('Singapura');
    expect(view.starters.map((link) => link.href)).toEqual([
      '/singapore/wealth',
      '/singapore/shipping',
      '/singapore/identity',
    ]);
    expect(view.moreQuestions).toEqual([]);
    expect(view.quickFacts[0]).toEqual({
      label: 'Population',
      value: '6.04 million',
      asOf: '2024',
    });
    expect(view.shell.scene.routes).toEqual([]);
    expect(view.shell.destination.storyId).toBeUndefined();
    expect(roundTrip(view)).toEqual(view);
  });

  it('gives a map-only country basics and a scene focused on it', () => {
    const view = buildCountryPage('CAN');
    if (view.kind !== 'map') throw new Error('expected a map-only country');
    expect(view.title).toBe('Canada');
    expect(view.flag).toBe('🇨🇦');
    expect(view.shell.scene).toEqual({
      focusCountryId: 'CAN',
      highlights: [],
      places: [],
      routes: [],
    });
    expect(view.population?.value).toBeGreaterThan(30_000_000);
    expect(view.nearby[0].href).toBe('/united-states');
    expect(describePage(view).description.length).toBeGreaterThan(20);
  });

  it('finds the closest edited countries', () => {
    expect(nearbyEditedCountries('CAN')[0]).toBe('USA');
    expect(nearbyEditedCountries('BRN')[0]).toBe('MYS');
    expect(nearbyEditedCountries('SGP')).not.toContain('SGP');
  });
});

describe('home and client indexes', () => {
  it('begins at home with the starting questions content suggests', () => {
    const home = buildHomeView();
    expect(home.suggestions.map((link) => link.href)).toEqual(
      getHome().suggestedQuestions.map(
        (ref) => buildStoryPage(ref.countryId, ref.storyId).shell.destination.href,
      ),
    );
    expect(home.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(home.suggestions.length).toBeLessThanOrEqual(4);
    expect(home.suggestions[0]).toMatchObject({
      href: '/singapore/shipping',
      title: 'Why is Singapore a shipping crossroads?',
      countryName: 'Singapore',
    });
    expect(roundTrip(home)).toEqual(home);
  });

  it('labels every map identity with its editorial name and page', () => {
    const labels = buildCountryLabels();
    expect(labels).toHaveLength(258);
    expect(labels.find((label) => label.id === 'SGP')).toMatchObject({
      name: 'Singapore',
      path: '/singapore',
    });
    for (const label of labels) {
      expect(Object.keys(label).sort()).toEqual([
        'area',
        'id',
        'lat',
        'lng',
        'name',
        'path',
        'rank',
      ]);
    }
  });

  it('indexes every country, question and trail', () => {
    const index = buildAtlasIndex();
    expect(index.countries).toHaveLength(258);
    expect(index.countries.filter((country) => country.edited)).toHaveLength(
      listCountries().length,
    );
    expect(index.stories).toHaveLength(listStories().length);
    expect(index.trails.length).toBeGreaterThan(0);
    expect(index.suggestions).toEqual(getHome().suggestedQuestions);
  });

  it('turns ISO codes into flags', () => {
    expect(flagEmoji('JP')).toBe('🇯🇵');
    expect(flagEmoji(null)).toBe('');
    expect(flagEmoji('-99')).toBe('');
  });
});
