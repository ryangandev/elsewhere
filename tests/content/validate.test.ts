import { describe, expect, it } from 'vitest';
import { englishContent } from '../../src/content/registry';
import { CountryFile, StoryRef, TrailStop } from '../../src/content/schema';
import { validateContent } from '../../src/content/validate';
import { contentInput, landIndex } from './load';

describe('content', () => {
  it('passes every schema, integrity, gazetteer and sea-route check', () => {
    expect(validateContent({ ...contentInput(), land: landIndex() })).toEqual([]);
  });

  it('registers every country file for the loaders', () => {
    const ids = (files: unknown[]) =>
      files.map((data) => CountryFile.parse(data).country.id).sort();
    expect(ids(englishContent.countryFiles)).toEqual(
      ids(contentInput().countryFiles.map(({ data }) => data)),
    );
  });

  it('is English only, apart from native country names', () => {
    const { countryFiles, trails, placeNotes } = contentInput();
    const text = JSON.stringify([countryFiles, trails, placeNotes], (key, value) =>
      key === 'nativeName' ? undefined : value,
    );
    expect(text).not.toMatch(/\p{Script=Han}/u);
    expect(text).not.toMatch(/"[A-Za-z]*Zh"\s*:/);
  });
});

describe('references', () => {
  it('point at stories by country ID and story ID only', () => {
    expect(StoryRef.safeParse({ countryId: 'SGP', storyId: 'shipping' }).success).toBe(true);
    // An array index, a title, or a country name is not a reference.
    expect(StoryRef.safeParse({ countryId: 'SGP', storyIndex: 1 }).success).toBe(false);
    expect(StoryRef.safeParse({ countryId: 'SGP', storyId: 1 }).success).toBe(false);
    expect(
      StoryRef.safeParse({ countryId: 'SGP', storyId: 'Why is Singapore rich?' }).success,
    ).toBe(false);
    expect(StoryRef.safeParse({ countryId: 'Singapore', storyId: 'shipping' }).success).toBe(false);
    expect(
      TrailStop.safeParse({ countryId: 'SGP', topicIndex: 0, connection: 'Begin here.' }).success,
    ).toBe(false);
  });

  it('are flagged when they point at a story that does not exist', () => {
    const input = contentInput();
    const trails = structuredClone(input.trails.data) as { stops: { storyId: string }[] }[];
    trails[0].stops[0].storyId = 'no-such-story';
    const issues = validateContent({ ...input, trails: { ...input.trails, data: trails } });
    expect(issues).toEqual([
      expect.objectContaining({
        file: input.trails.file,
        message: 'Unknown story "SGP/no-such-story"',
      }),
    ]);
  });

  it('never use index keys in content', () => {
    const { countryFiles, trails } = contentInput();
    expect(JSON.stringify([countryFiles, trails])).not.toMatch(/"[A-Za-z]*(?:Index|Idx)"\s*:/);
  });
});
