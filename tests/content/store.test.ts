import { describe, expect, it } from 'vitest';
import * as content from '../../src/content';
import { getPlace } from '../../src/content/geo';
import { localeContentDir, readContentTree } from '../../src/content/files';
import { CountryFile } from '../../src/content/schema';
import { createContentStore, type ContentSources } from '../../src/content/store';
import { readJson } from './load';

const entry = (file: string) => ({ file, data: readJson(file) });

describe('loaders', () => {
  it('find countries by ID or slug', () => {
    expect(content.getCountry('SGP')?.name).toBe('Singapore');
    expect(content.getCountry('sgp')?.id).toBe('SGP');
    expect(content.getCountry('united-states')?.id).toBe('USA');
    expect(content.getCountry('atlantis')).toBeUndefined();
    expect(content.listCountries().map((country) => country.id)).toHaveLength(10);
  });

  it('find stories by ID or slug', () => {
    expect(content.getStory('SGP', 'shipping')?.countryId).toBe('SGP');
    expect(content.getStoryBySlug('singapore', 'shipping')?.id).toBe('shipping');
    expect(content.getStory('SGP', 'no-such-story')).toBeUndefined();
    expect(content.listStories('SGP').map((story) => story.id)).toEqual([
      'wealth',
      'shipping',
      'identity',
    ]);
    expect(content.listStories()).toHaveLength(30);
    expect(content.listTrails().length).toBeGreaterThan(0);
  });
});

describe('resolveScene', () => {
  it('takes coordinates from the gazetteer and notes from content', () => {
    const story = content.getStory('SGP', 'wealth')!;
    const scene = content.resolveScene(story.scene);

    expect(scene.focusCountryId).toBe('SGP');
    expect(scene.highlights).toEqual(story.scene.highlights);
    expect(scene.places.map((place) => place.id)).toEqual(story.scene.placeIds);
    const strait = scene.places.find((place) => place.id === 'strait-of-malacca')!;
    const gazetteer = getPlace('strait-of-malacca')!;
    expect(strait).toMatchObject({
      name: gazetteer.name,
      lat: gazetteer.lat,
      lng: gazetteer.lng,
      kind: 'water',
      note: content.getPlaceNote('strait-of-malacca'),
    });
    expect(strait.note).toBeTruthy();

    expect(scene.routes).toHaveLength(1);
    const [route] = scene.routes;
    expect(route).toMatchObject({ id: 'malacca-passage', kind: 'sea' });
    expect(route.points.length).toBeGreaterThan(10);
    expect(route.points[0]).toEqual([getPlace('andaman-sea')!.lat, getPlace('andaman-sea')!.lng]);
  });

  it('marks a country place at the part of the country the scene looks at', () => {
    // Malaysia's label point is on Borneo, far from the Strait of Malacca.
    const scene = content.resolveScene(content.getStory('SGP', 'shipping')!.scene);
    const malaysia = scene.places.find((place) => place.id === 'malaysia')!;
    expect(malaysia.lng).toBeLessThan(105);
    expect(malaysia.lng).not.toBe(getPlace('malaysia')!.lng);
    // Indonesia's label point, on Sumatra, already faces the strait.
    const indonesia = scene.places.find((place) => place.id === 'indonesia')!;
    expect(indonesia).toMatchObject({ lat: getPlace('indonesia')!.lat, lng: getPlace('indonesia')!.lng });
  });

  it('keeps the camera of a country scene', () => {
    const country = content.getCountry('JPN')!;
    expect(content.resolveScene(country.scene).camera).toEqual(country.scene.camera);
  });

  it('rejects a place missing from the gazetteer', () => {
    const scene = content.getCountry('SGP')!.scene;
    expect(() => content.resolveScene({ ...scene, placeIds: ['atlantis'] })).toThrow('atlantis');
  });
});

describe('draft filtering', () => {
  // Singapore stays reviewed apart from one draft story; Malaysia becomes a draft country.
  function sources(): ContentSources {
    const singapore = CountryFile.parse(readJson('content/en/countries/singapore.json'));
    const malaysia = CountryFile.parse(readJson('content/en/countries/malaysia.json'));
    const draft = {
      generatedBy: 'claude-opus-5-5',
      generatedAt: '2026-10-01',
      status: 'draft',
    } as const;
    singapore.stories[1].provenance = draft;
    malaysia.country.provenance = draft;
    return {
      countryFiles: [
        { file: 'singapore.json', data: singapore },
        { file: 'malaysia.json', data: malaysia },
      ],
      trails: entry('content/en/trails.json'),
      placeNotes: entry('content/en/places.json'),
      home: {
        file: 'home.json',
        data: {
          suggestedQuestions: [
            { countryId: 'SGP', storyId: 'wealth' },
            { countryId: 'SGP', storyId: draftStory },
            { countryId: 'MYS', storyId: 'electronics' },
          ],
        },
      },
    };
  }
  const draftStory = 'shipping';

  it('hides drafts in production and removes every link to them', () => {
    const store = createContentStore(sources(), { includeDrafts: false });

    expect(store.listCountries().map((country) => country.id)).toEqual(['SGP']);
    expect(store.getCountry('MYS')).toBeUndefined();
    expect(store.listStories('MYS')).toEqual([]);
    expect(store.getStory('SGP', draftStory)).toBeUndefined();
    expect(store.listStories('SGP').map((story) => story.id)).toEqual(['wealth', 'identity']);
    expect(store.getCountry('SGP')!.starterStoryIds).not.toContain(draftStory);

    const links = store
      .listStories()
      .flatMap((story) => story.next)
      .concat(store.listTrails().flatMap((trail) => trail.stops));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(store.getStory(link.countryId, link.storyId), JSON.stringify(link)).toBeDefined();
    }
    for (const trail of store.listTrails()) expect(trail.stops.length).toBeGreaterThanOrEqual(2);
    expect(store.getHome().suggestedQuestions).toEqual([{ countryId: 'SGP', storyId: 'wealth' }]);
  });

  it('shows drafts in development', () => {
    const store = createContentStore(sources(), { includeDrafts: true });

    expect(store.listCountries().map((country) => country.id)).toEqual(['MYS', 'SGP']);
    expect(store.getStory('SGP', draftStory)).toBeDefined();
    expect(store.getCountry('SGP')!.starterStoryIds).toContain(draftStory);
    expect(store.getHome().suggestedQuestions).toHaveLength(3);
  });

  it('is what the default loaders do for the build environment', () => {
    // Tests run outside production, so the default store includes drafts; all English content
    // is reviewed, so the result is the same either way.
    const production = createContentStore(readContentTree(localeContentDir('en')), {
      includeDrafts: false,
    });
    expect(production.listStories()).toEqual(content.listStories());
    expect(production.getHome()).toEqual(content.getHome());
  });
});
