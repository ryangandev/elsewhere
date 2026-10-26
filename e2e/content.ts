import { readdirSync, readFileSync } from 'node:fs';

/**
 * The English edition as the tests need it: just enough of each content file to know what the
 * site should show. The tests read the JSON files directly instead of importing `src/content`,
 * which is server-only code, and so that they check the built site against the content itself.
 * Only reviewed content is built into production (docs/architecture.md#content-model).
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

export function getStory(countryId: string, storyId: string): Story {
  const story = editions
    .find(({ country }) => country.id === countryId)
    ?.stories.find((candidate) => candidate.id === storyId);
  if (!story) throw new Error(`No reviewed story ${countryId}/${storyId} in content/en`);
  return story;
}

export function getCountry(countryId: string): Country {
  const edition = editions.find(({ country }) => country.id === countryId);
  if (!edition) throw new Error(`No reviewed country ${countryId} in content/en`);
  return edition.country;
}

/** Where a story lives: /<country>/<story>. */
export function storyPath(story: Story): string {
  return `/${getCountry(story.countryId).slug}/${story.slug}`;
}

/** The questions the home page suggests, in order (content/en/home.json). */
export function suggestedStories(): Story[] {
  const home = readJson<{ suggestedQuestions: StoryRef[] }>('home.json');
  return home.suggestedQuestions.map((ref) => getStory(ref.countryId, ref.storyId));
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
