import { directory, getCountry } from './catalog';
import { topicDestination, type Destination } from './destination';

/** Extra search terms per country: common names, spellings, and topics people ask about. */
const aliases: Record<string, string> = {
  SGP: 'rich wealthy wealth port shipping',
  CHN: 'china manufacturing',
  USA: 'usa america us dollar',
  JPN: 'japan aging aged ageing old',
  TUR: 'türkiye turkey strait',
  BRA: 'brasil brazil rainforest amazon',
  FRA: 'france french',
  IND: 'india monsoon',
  MYS: 'malaysia chips semiconductors',
  IDN: 'indonesia islands',
};

const stopWords = new Set([
  'why',
  'how',
  'what',
  'does',
  'did',
  'is',
  'a',
  'an',
  'the',
  'so',
  'of',
  'in',
  'to',
  'are',
  'do',
  'can',
  'become',
  'it',
]);

export type SearchResult = {
  destination: Destination;
  title: string;
  subtitle: string;
  kind: 'story' | 'country' | 'map';
  score: number;
};

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[?？.,!]/g, '')
    .split(/\s+/)
    .filter((token) => token && !stopWords.has(token));
}

/**
 * Ranks countries and questions against a free-text query.
 * `countryId` boosts questions about the country the reader is already looking at.
 */
export function searchAtlas(query: string, countryId?: string): SearchResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const score = (text: string) => {
    const lower = text.toLowerCase();
    return tokens.reduce((total, token) => total + (lower.includes(token) ? 1 : 0), 0);
  };

  const results: SearchResult[] = [];
  for (const country of directory) {
    const profile = getCountry(country.id);
    const countryScore = score(`${country.name} ${country.id} ${aliases[country.id] ?? ''}`);
    if (countryScore) {
      results.push({
        destination: { countryId: country.id },
        title: country.name,
        subtitle: `${country.region} · ${profile ? 'Country story' : 'Basic overview'}`,
        kind: profile ? 'country' : 'map',
        score: countryScore * 4,
      });
    }
    profile?.topics.forEach((topic, index) => {
      const sectionText = topic.sections.map((section) => section.text).join(' ');
      const topicScore = score(`${topic.title} ${topic.category} ${topic.intro} ${sectionText}`);
      if (!topicScore && !countryScore) return;
      results.push({
        destination: topicDestination(profile, index),
        title: topic.title,
        subtitle: `${profile.name} · ${topic.category}`,
        kind: 'story',
        score: topicScore * 3 + countryScore + (country.id === countryId ? 2 : 0),
      });
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 16);
}
