import { describe, expect, it } from 'vitest';
import { StoryRef, TrailStop } from '../../src/content/schema';
import { validateContent } from '../../src/content/validate';
import { contentInput, landIndex } from './load';

describe('content', () => {
  it('passes every schema, integrity, gazetteer and sea-route check', () => {
    expect(validateContent({ ...contentInput(), land: landIndex() })).toEqual([]);
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

  it('from the home screen are a few existing, distinct questions', () => {
    const input = contentInput();
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

  it('never use index keys in content', () => {
    const { countryFiles, trails } = contentInput();
    expect(JSON.stringify([countryFiles, trails])).not.toMatch(/"[A-Za-z]*(?:Index|Idx)"\s*:/);
  });
});

describe('paraphrases', () => {
  /** Validation messages after giving Singapore's wealth story these paraphrases. */
  function withParaphrases(paraphrases: Record<string, unknown>) {
    const input = contentInput();
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
