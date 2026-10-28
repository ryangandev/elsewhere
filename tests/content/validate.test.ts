import { describe, expect, it } from 'vitest';
import { StoryRef, TrailStop } from '../../src/content/schema';
import { validateContent } from '../../src/content/validate';
import { fixtureInput, landIndex, liveContentInput } from './load';

// The only tests here that read content/en. They go red when production content is invalid, and
// for no other reason: they assert nothing about how many countries it has or what is reviewed.
describe('production content', () => {
  it('passes every schema, integrity, gazetteer and sea-route check', () => {
    expect(validateContent({ ...liveContentInput(), land: landIndex() })).toEqual([]);
  });

  it('is English only, apart from native country names', () => {
    const { countryFiles, trails, placeNotes } = liveContentInput();
    const text = JSON.stringify([countryFiles, trails, placeNotes], (key, value) =>
      key === 'nativeName' ? undefined : value,
    );
    expect(text).not.toMatch(/\p{Script=Han}/u);
    expect(text).not.toMatch(/"[A-Za-z]*Zh"\s*:/);
  });

  it('never uses index keys', () => {
    const { countryFiles, trails } = liveContentInput();
    expect(JSON.stringify([countryFiles, trails])).not.toMatch(/"[A-Za-z]*(?:Index|Idx)"\s*:/);
  });
});

describe('fixture content', () => {
  it('is valid, so each test below changes one thing in a tree that passes', () => {
    expect(validateContent({ ...fixtureInput(), land: landIndex() })).toEqual([]);
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
    const input = fixtureInput();
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

  it('from the home screen are a few existing, distinct questions', () => {
    const input = fixtureInput();
    const withHome = (suggestedQuestions: unknown[]) =>
      validateContent({ ...input, home: { ...input.home, data: { suggestedQuestions } } });
    const shipping = { countryId: 'SGP', storyId: 'shipping' };
    const wealth = { countryId: 'SGP', storyId: 'wealth' };
    const dollar = { countryId: 'USA', storyId: 'dollar' };

    expect(withHome([shipping, wealth, dollar])).toEqual([]);
    expect(withHome([shipping, wealth, { countryId: 'SGP', storyId: 'gone' }])).toEqual([
      expect.objectContaining({
        path: 'suggestedQuestions[2]',
        message: 'Unknown story "SGP/gone"',
      }),
    ]);
    expect(withHome([shipping, wealth, shipping])).toEqual([
      expect.objectContaining({ message: '"SGP/shipping" is suggested twice' }),
    ]);
    // Never a catalog: at least three, at most four.
    expect(withHome([shipping, wealth])).not.toEqual([]);
    expect(withHome([shipping, wealth, dollar, shipping, wealth])).not.toEqual([]);
    expect(withHome([{ ...shipping, reason: 'Begin here.' }, wealth, dollar])).not.toEqual([]);
  });

  it('from the home screen leave production at least three while some are drafts', () => {
    type Provenance = { status: string; reviewedBy?: string; reviewedAt?: string };
    type File = {
      country: { id: string; provenance: Provenance };
      stories: { id: string; provenance: Provenance }[];
    };
    const asDraft = (provenance: Provenance) => ({
      ...provenance,
      status: 'draft',
      reviewedBy: undefined,
      reviewedAt: undefined,
    });
    /** The fixture with these suggested stories (or, for a bare country ID, the country) reopened. */
    const reopened = (...refs: string[]) => {
      const input = fixtureInput();
      const countryFiles = input.countryFiles.map((entry) => {
        const data = structuredClone(entry.data) as File;
        if (refs.includes(data.country.id))
          data.country.provenance = asDraft(data.country.provenance);
        for (const story of data.stories) {
          if (refs.includes(`${data.country.id}/${story.id}`))
            story.provenance = asDraft(story.provenance);
        }
        return { ...entry, data };
      });
      return validateContent({ ...input, countryFiles }).filter(
        (issue) => issue.file === input.home.file,
      );
    };

    // Four are suggested, so one can be reopened; production shows the other three.
    expect(reopened('SGP/shipping')).toEqual([]);
    expect(reopened('SGP/shipping', 'USA/dollar')).toEqual([
      expect.objectContaining({
        path: 'suggestedQuestions',
        message:
          'Production shows only 2 of these questions, fewer than 3, while "SGP/shipping", "USA/dollar" are drafts; approve them again or suggest reviewed questions instead',
      }),
    ]);
    // A story in a country sent back whole is unpublished too.
    expect(reopened('SGP/shipping', 'FRA')).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('"SGP/shipping", "FRA/overseas"'),
      }),
    ]);
  });
});

describe('source IDs', () => {
  /** Singapore with the URL of the first source its overview cites declared again by a story. */
  function withStorySource(url: (overviewUrl: string) => string) {
    const input = fixtureInput();
    let overviewSource: { id: string; url: string } | undefined;
    const countryFiles = input.countryFiles.map((entry) => {
      if (!entry.file.endsWith('/singapore.json')) return entry;
      const data = structuredClone(entry.data) as {
        country: { sources: { id: string; url: string }[] };
        stories: { id: string; sources: { id: string; url: string }[] }[];
      };
      overviewSource = data.country.sources[0];
      const story = data.stories[0];
      story.sources = [
        ...story.sources.filter((source) => source.id !== overviewSource!.id),
        { ...overviewSource, url: url(overviewSource.url) },
      ];
      return { ...entry, data, story: story.id };
    });
    const story = (countryFiles.find((entry) => 'story' in entry) as { story: string }).story;
    const messages = validateContent({ ...input, countryFiles })
      .filter((issue) => issue.path === 'sources')
      .map((issue) => issue.message);
    return { messages, overviewSource: overviewSource!, story };
  }

  it('name one document in a file, and a clash says where each URL is declared', () => {
    expect(withStorySource((url) => url).messages).toEqual([]);
    const { messages, overviewSource, story } = withStorySource(() => 'https://example.org/other');
    expect(messages).toEqual([
      `Source "${overviewSource.id}" points to two different URLs: the overview declares ${overviewSource.url} and story "${story}" declares https://example.org/other. One source ID names one document in a file, so use the same URL in both or give the other document its own ID`,
    ]);
  });
});

describe('paraphrases', () => {
  /** Validation messages after giving Singapore's wealth story these paraphrases. */
  function withParaphrases(paraphrases: Record<string, unknown>) {
    const input = fixtureInput();
    const countryFiles = input.countryFiles.map((entry) => {
      if (!entry.file.endsWith('/singapore.json')) return entry;
      const data = structuredClone(entry.data) as { stories: Record<string, unknown>[] };
      const story = data.stories.find((item) => item.id === 'wealth')!;
      story.paraphrases = {
        question: story.question,
        generatedBy: 'claude-opus-5-5',
        generatedAt: '2026-10-26',
        promptVersion: 'paraphrase/v1',
        ...paraphrases,
      };
      return { ...entry, data };
    });
    return validateContent({ ...input, countryFiles }).map((issue) => issue.message);
  }

  const good = [
    'Why is Singapore so rich?',
    'Why is Singapore loaded?',
    'What made Singapore wealthy?',
  ];

  it('need no sources, because they restate the question', () => {
    expect(withParaphrases({ phrasings: good })).toEqual([]);
  });

  it('are stale once the question changes', () => {
    expect(withParaphrases({ phrasings: good, question: 'Why is Singapore rich?' })).toEqual([
      expect.stringContaining('Paraphrases were written for "Why is Singapore rich?"'),
    ]);
  });

  it('never repeat the question, each other, or a sibling question', () => {
    expect(
      withParaphrases({
        phrasings: [
          ...good,
          'how did a tiny island become so wealthy',
          'why is singapore so rich',
          'Why is Singapore a shipping crossroads?',
        ],
      }),
    ).toEqual([
      '"how did a tiny island become so wealthy" repeats the question',
      '"why is singapore so rich" is listed twice',
      '"Why is Singapore a shipping crossroads?" is the question of story "shipping"',
    ]);
  });

  it('are a handful of short phrasings', () => {
    expect(withParaphrases({ phrasings: good.slice(0, 2) })).not.toEqual([]);
    expect(
      withParaphrases({ phrasings: [...good, `Why ${'really '.repeat(20)}rich?`] }),
    ).not.toEqual([]);
  });
});
