import { readdirSync, readFileSync } from 'node:fs';
import { test } from '@playwright/test';

/**
 * The English edition as the tests need it: just enough of each content file to know what the
 * site should show. The tests read the JSON files directly instead of importing `src/content`,
 * which is server-only code, and so that they check the built site against the content itself.
 * Only reviewed content is built into production (docs/architecture.md#content-model).
 *
 * The built site holds whatever content/en has reviewed when it was built, so a test must not
 * assume a particular story is there. A test that needs "a story" asks for an example with
 * `exampleStory`: the story it names when that is reviewed, else any reviewed story that fits,
 * and it skips with a message when there is none. Lists the site filters (suggested questions,
 * trails, starter questions) are filtered here the same way.
 */

export type Source = { id: string; title: string; publisher: string; url: string };
export type StoryRef = { countryId: string; storyId: string; reason?: string };

export type Story = {
  id: string;
  countryId: string;
  slug: string;
  question: string;
  category: string;
  sections: { title: string; text: string; sourceIds: string[] }[];
  next: StoryRef[];
  sources: Source[];
  paraphrases?: { phrasings: string[] };
  scene: { placeIds: string[] };
  provenance: { status: 'draft' | 'reviewed' };
};

export type Country = {
  id: string;
  slug: string;
  name: string;
  kicker: string;
  starterStoryIds: string[];
  provenance: { status: 'draft' | 'reviewed' };
};

export type Edition = { country: Country; stories: Story[] };

const contentDir = new URL('../content/en/', import.meta.url);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, contentDir), 'utf8')) as T;
}

/** Every edited country with the reviewed stories that ship. */
export const editions: Edition[] = readdirSync(new URL('countries/', contentDir))
  .filter((file) => file.endsWith('.json'))
  .map((file) => readJson<Edition>(`countries/${file}`))
  .filter(({ country }) => country.provenance.status === 'reviewed')
  .map(({ country, stories }) => ({
    country,
    stories: stories.filter((story) => story.provenance.status === 'reviewed'),
  }));

const reviewedStories = (): Story[] => editions.flatMap(({ stories }) => stories);

export function getStory(countryId: string, storyId: string): Story {
  const story = reviewedStories().find(
    (candidate) => candidate.countryId === countryId && candidate.id === storyId,
  );
  if (!story) throw new Error(`No reviewed story ${countryId}/${storyId} in content/en`);
  return story;
}

export function getCountry(countryId: string): Country {
  const edition = editions.find(({ country }) => country.id === countryId);
  if (!edition) throw new Error(`No reviewed country ${countryId} in content/en`);
  return edition.country;
}

/** What an example story must have for the test that uses it to mean anything. */
export type Need =
  /** Next questions that production publishes. */
  | 'next'
  /** Next questions that production publishes, one of them about another country. */
  | 'elsewhere'
  /** Places on its map. */
  | 'places';

const fits: Record<Need, (story: Story) => boolean> = {
  next: (story) => nextStories(story).length > 0,
  elsewhere: (story) => nextStories(story).some((next) => next.countryId !== story.countryId),
  places: (story) => story.scene.placeIds.length > 0,
};

/**
 * The story a test uses as its example: `countryId/storyId` when it is reviewed and fits `needs`,
 * else the first reviewed story that does, preferring another country than `not` when given.
 * With none, the test is skipped with a message (every test of the file, when called at the top
 * level, where the result is then undefined, so use it only inside the tests that run).
 */
export function exampleStory(
  countryId: string,
  storyId: string,
  { needs = [], not }: { needs?: Need[]; not?: Story } = {},
): Story {
  const fitting = reviewedStories().filter(
    (story) => story !== not && needs.every((need) => fits[need](story)),
  );
  const story =
    fitting.find((candidate) => candidate.countryId === countryId && candidate.id === storyId) ??
    fitting.find((candidate) => candidate.countryId !== not?.countryId) ??
    fitting[0];
  if (!story) {
    test.skip(
      true,
      `content/en has no reviewed story to stand in for ${countryId}/${storyId}${needs.length ? ` (needs: ${needs.join(', ')})` : ''}`,
    );
  }
  return story as Story;
}

/** `countryId`'s country when it is reviewed, else the first reviewed one; skips when none is. */
export function exampleCountry(countryId: string): Country {
  const edition = editions.find(({ country }) => country.id === countryId) ?? editions[0];
  if (!edition) test.skip(true, `content/en has no reviewed country to stand in for ${countryId}`);
  return edition?.country as Country;
}

/** What a reader types to find a story: for Singapore's wealth, a wording of its own. */
export function askedAs(story: Story): string {
  if (story.countryId === 'SGP' && story.id === 'wealth') return 'What makes Singapore wealthy?';
  return story.paraphrases?.phrasings[0] ?? story.question;
}

/** A country's starter questions that production publishes, in order. */
export function starterStories({ country, stories }: Edition): Story[] {
  return country.starterStoryIds.flatMap((id) => stories.filter((story) => story.id === id));
}

/** Where a story lives: /<country>/<story>. */
export function storyPath(story: Story): string {
  return `/${getCountry(story.countryId).slug}/${story.slug}`;
}

/** The questions the home page suggests that production publishes, in order (home.json). */
export function suggestedStories(): Story[] {
  const home = readJson<{ suggestedQuestions: StoryRef[] }>('home.json');
  return home.suggestedQuestions.flatMap((ref) => {
    const story = reviewedStories().find(
      (candidate) => candidate.countryId === ref.countryId && candidate.id === ref.storyId,
    );
    return story ? [story] : [];
  });
}

export type Trail = {
  id: string;
  title: string;
  stops: StoryRef[];
};

/**
 * The trails the trails drawer lists, in order (trails.json): each with the stops that production
 * publishes, and only a trail that keeps at least two.
 */
export function trails(): Trail[] {
  return readJson<Trail[]>('trails.json')
    .map((trail) => ({
      ...trail,
      stops: trail.stops.filter((stop) =>
        reviewedStories().some(
          (story) => story.countryId === stop.countryId && story.id === stop.storyId,
        ),
      ),
    }))
    .filter((trail) => trail.stops.length >= 2);
}

/** The reviewed stories a story leads to, in order. */
export function nextStories(story: Story): Story[] {
  return story.next.flatMap((ref) => {
    try {
      return [getStory(ref.countryId, ref.storyId)];
    } catch {
      return [];
    }
  });
}
