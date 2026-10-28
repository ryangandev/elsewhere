import { describe, expect, it } from 'vitest';
import { Story, StoryId, StoryRef, TrailStop } from '../../src/content/schema';
import { validateContent, type ContentIssue } from '../../src/content/validate';
import {
  HAND_CONVERTED_CONTENT_DIR,
  contentInput,
  fixtureInput,
  landIndex,
  liveContentInput,
} from './load';

// The only test here that reads content/en, and the one live content gate: every rule lives in
// validateContent, so `npm run content:check` and this test cannot disagree. It goes red when
// production content is invalid, and for no other reason: it asserts nothing about how many
// countries it has or what is reviewed. The rules themselves are tested on the fixtures below.
describe('production content', () => {
  it('passes every schema, integrity, gazetteer and sea-route check', () => {
    expect(validateContent({ ...liveContentInput(), land: landIndex() })).toEqual([]);
  });
});

describe('fixture content', () => {
  it('is valid, so each test below changes one thing in a tree that passes', () => {
    expect(validateContent({ ...fixtureInput(), land: landIndex() })).toEqual([]);
  });

  // Many pipeline, deployment and page tests run on this frozen tree. Schema and rule changes
  // must migrate it with content/en, or those tests would exercise content the site rejects.
  it('keeps the frozen hand-converted tree valid under the current schema and rules', () => {
    const input = contentInput(HAND_CONVERTED_CONTENT_DIR);
    expect(validateContent({ ...input, land: landIndex() })).toEqual([]);
  });
});

// A key the schema does not know is also an issue; these tests look at the rule under test only.
const ruleIssues = (issues: ContentIssue[]) =>
  issues.filter((issue) => /English only|is an index/.test(issue.message));

type Edit = [path: (string | number)[], value: unknown];

function setAt(root: unknown, [...path]: Edit[0], value: unknown) {
  const last = path.pop()!;
  let node = root as Record<string | number, unknown>;
  for (const key of path) node = node[key] as Record<string | number, unknown>;
  node[last] = value;
}

/** The fixture with values set in the Singapore file and in the trails, and the rule's issues. */
function editedIssues(edits: { singapore?: Edit[]; trails?: Edit[] }) {
  const input = fixtureInput();
  const trails = structuredClone(input.trails.data);
  for (const [path, value] of edits.trails ?? []) setAt(trails, path, value);
  const countryFiles = input.countryFiles.map((entry) => {
    if (!entry.file.endsWith('/singapore.json')) return entry;
    const data = structuredClone(entry.data);
    for (const [path, value] of edits.singapore ?? []) setAt(data, path, value);
    return { ...entry, data };
  });
  return ruleIssues(
    validateContent({ ...input, countryFiles, trails: { ...input.trails, data: trails } }),
  );
}

describe('English only', () => {
  it('allows a country its own name for itself', () => {
    expect(editedIssues({ singapore: [[['country', 'nativeName'], '新加坡']] })).toEqual([]);
  });

  it('flags Han text anywhere else, naming where it is, including a Japanese gloss', () => {
    expect(
      editedIssues({
        singapore: [[['stories', 0, 'summary'], 'Shinkansen (新幹線) is fast.']],
        trails: [[[0, 'description'], 'Water 连接 us.']],
      }),
    ).toEqual([
      expect.objectContaining({
        path: 'stories[0].summary',
        message:
          "Content is English only, but this contains non-English (Han) text outside a country's native name",
      }),
      expect.objectContaining({
        file: fixtureInput().trails.file,
        path: '[0].description',
        message:
          "Content is English only, but this contains non-English (Han) text outside a country's native name",
      }),
    ]);
  });

  /** The rule's issues after changing the fixture's place notes. */
  function placeNoteIssues(change: (notes: Record<string, string>) => Record<string, string>) {
    const input = fixtureInput();
    const data = change({ ...(input.placeNotes.data as Record<string, string>) });
    const issues = validateContent({ ...input, placeNotes: { ...input.placeNotes, data } });
    return { issues: ruleIssues(issues), file: input.placeNotes.file };
  }

  it('flags Han text in a place note', () => {
    const { issues, file } = placeNoteIssues((notes) => {
      notes[Object.keys(notes)[0]] = '海峡';
      return notes;
    });
    expect(issues).toEqual([expect.objectContaining({ file, path: expect.any(String) })]);
  });

  it('flags Han text in a key, which is not a value', () => {
    const { issues, file } = placeNoteIssues((notes) => ({ ...notes, 海峡: 'A strait.' }));
    expect(issues).toEqual([
      {
        file,
        path: '海峡',
        message: 'Content is English only, but the key "海峡" contains non-English (Han) text',
      },
    ]);
  });

  it('flags a Chinese-language field next to an English one', () => {
    expect(editedIssues({ singapore: [[['stories', 0, 'questionZh'], 'Why?']] })).toEqual([
      expect.objectContaining({
        path: 'stories[0].questionZh',
        message: 'Content is English only, but "questionZh" is a Chinese field',
      }),
    ]);
  });
});

describe('index keys', () => {
  it('are flagged anywhere in a country file or a trail, since content refers to IDs', () => {
    expect(
      editedIssues({
        singapore: [[['stories', 0, 'next', 0, 'storyIdx'], 1]],
        trails: [[[0, 'stops', 0, 'topicIndex'], 0]],
      }),
    ).toEqual([
      expect.objectContaining({
        path: 'stories[0].next[0].storyIdx',
        message: '"storyIdx" is an index; refer to stories and countries by ID',
      }),
      expect.objectContaining({
        file: fixtureInput().trails.file,
        path: '[0].stops[0].topicIndex',
        message: '"topicIndex" is an index; refer to stories and countries by ID',
      }),
    ]);
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

describe('story IDs', () => {
  it('reserve "overview", which names the claims agent session of a country overview', () => {
    const result = StoryId.safeParse('overview');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'The story ID "overview" is reserved for the country overview',
    );
    expect(StoryRef.safeParse({ countryId: 'SGP', storyId: 'overview' }).success).toBe(false);
  });

  it('still allow other slugs, including ones that contain "overview"', () => {
    for (const id of ['shipping', 'overview-of-trade', 'trade-overview']) {
      expect(StoryId.safeParse(id).success, id).toBe(true);
    }
  });

  it('refuse a story with the ID "overview"', () => {
    const [{ data }] = fixtureInput().countryFiles;
    const [story] = (data as { stories: Record<string, unknown>[] }).stories;
    expect(Story.safeParse(story).success).toBe(true);
    const result = Story.safeParse({ ...story, id: 'overview' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['id']]);
  });
});
