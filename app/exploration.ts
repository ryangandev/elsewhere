import { countries, type Country, type Place } from './data';
import { chineseProfiles } from './chinese-content';
import { topicLabel } from './localized-content';
import { countryBasics, countryName, regionName, type Locale } from './locale-data';
import mapIndex from './country-index.json';

export type Destination = { countryId: string; topicId?: string; trailId?: string };
export type MapCountry = { id: string; name: string; region: string; lat: number; lng: number };
export type Trail = { id: string; title: string; description: string; label: string; stops: (Destination & { connection: string })[] };
// Permanent URL identifiers are independent of titles and their display order.
export const topicIds: Record<string, string[]> = Object.fromEntries(countries.map(country => [country.id, country.topics.map(topic => topic.id)]));
export const directory: MapCountry[] = [
  ...mapIndex.filter(item => !countries.some(country => country.id === item.id)),
  ...countries.map(({ id, name, region, lat, lng }) => ({ id, name, region, lat, lng })),
].sort((a, b) => a.name.localeCompare(b.name));
export const trails: Trail[] = [
  {
    id: 'water-connects', title: 'The water between us', label: 'SEAS & CONNECTIONS',
    description: 'A busy strait, two shores, a thousand islands. Follow the water that connects them.',
    stops: [
      { countryId: 'SGP', topicId: 'shipping', connection: 'Begin at a crossroads of world trade.' },
      { countryId: 'MYS', topicId: 'two-shores', connection: 'Across the strait, one federation stretches across two shores.' },
      { countryId: 'IDN', topicId: 'islands', connection: 'To the south, water connects an entire archipelago.' },
      { countryId: 'TUR', topicId: 'straits', connection: 'Now look west: another narrow passage connects whole regions.' },
    ],
  },
  {
    id: 'made-together', title: 'Made in many places', label: 'WORK & THE WORLD',
    description: 'Look inside the things you use. Their stories cross more borders than their labels suggest.',
    stops: [
      { countryId: 'JPN', topicId: 'industry', connection: 'Start with the parts and systems inside familiar products.' },
      { countryId: 'CHN', topicId: 'manufacturing', connection: 'Follow the production networks across East Asia.' },
      { countryId: 'MYS', topicId: 'electronics', connection: 'Look closer at another link inside your electronics.' },
      { countryId: 'IND', topicId: 'technology', connection: 'Connections also carry services, not only physical goods.' },
    ],
  },
  {
    id: 'land-shapes-life', title: 'The land shapes the story', label: 'NATURE & EVERYDAY LIFE',
    description: 'Rainforests, monsoon winds, and river corridors. See geography at work in everyday life.',
    stops: [
      { countryId: 'BRA', topicId: 'amazon', connection: 'Start with a forest that moves water through the atmosphere.' },
      { countryId: 'IND', topicId: 'monsoon', connection: 'Across the ocean, seasonal rain organizes everyday life.' },
      { countryId: 'USA', topicId: 'geography', connection: 'Follow a river system through a continental economy.' },
    ],
  },
];

export function getCountry(id?: string) { return countries.find(country => country.id === id); }
export function getTopic(destination: Destination | null) {
  if (!destination?.topicId) return undefined;
  const country = getCountry(destination.countryId);
  return country?.topics.find(topic => topic.id === destination.topicId);
}
export function destinationKey(destination: Destination) { return `${destination.countryId}:${destination.topicId ?? ''}`; }
export function validDestination(value: unknown): Destination | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.countryId !== 'string' || !directory.some(c => c.id === candidate.countryId)) return null;
  const result: Destination = { countryId: candidate.countryId };
  if (typeof candidate.topicId === 'string' && topicIds[result.countryId]?.includes(candidate.topicId)) result.topicId = candidate.topicId;
  if (typeof candidate.trailId === 'string' && trails.some(trail => trail.id === candidate.trailId && trail.stops.some(stop => destinationKey(stop) === destinationKey(result)))) result.trailId = candidate.trailId;
  return result;
}
export function readDestination(search: string): Destination | null {
  const params = new URLSearchParams(search);
  return validDestination({ countryId: params.get('country')?.toUpperCase(), topicId: params.get('topic'), trailId: params.get('trail') });
}
export function destinationUrl(destination: Destination | null): string {
  if (!destination) return '/';
  const params = new URLSearchParams({ country: destination.countryId.toLowerCase() });
  if (destination.topicId) params.set('topic', destination.topicId);
  if (destination.trailId) params.set('trail', destination.trailId);
  return `/?${params}`;
}
export function topicDestination(country: Country, index: number): Destination {
  return { countryId: country.id, topicId: country.topics[index].id };
}
export function nearbyCountries(place: MapCountry): Country[] {
  // Great-circle ordering also behaves correctly across the antimeridian.
  const rad = Math.PI / 180;
  const distance = (country: Country) => Math.sin((country.lat - place.lat) * rad / 2) ** 2
    + Math.cos(place.lat * rad) * Math.cos(country.lat * rad) * Math.sin((country.lng - place.lng) * rad / 2) ** 2;
  return countries.filter(c => c.id !== place.id).sort((a, b) => distance(a) - distance(b)).slice(0, 3);
}

const related: Record<string, { countryId: string; topicId: string; connection: string }[]> = {
  SGP: [{ countryId: 'MYS', topicId: 'two-shores', connection: 'Meet the federation just across the strait.' }, { countryId: 'TUR', topicId: 'straits', connection: 'Another narrow passage with an outsized role.' }],
  JPN: [{ countryId: 'CHN', topicId: 'manufacturing', connection: 'Follow the region’s connected manufacturing systems.' }, { countryId: 'IND', topicId: 'technology', connection: 'A different path into the global economy.' }],
  BRA: [{ countryId: 'IDN', topicId: 'nature', connection: 'Explore another country with extraordinary biodiversity.' }, { countryId: 'FRA', topicId: 'overseas', connection: 'See why France also belongs on a South American map.' }],
  TUR: [{ countryId: 'SGP', topicId: 'shipping', connection: 'Compare another strategic meeting point of seas.' }, { countryId: 'FRA', topicId: 'europe', connection: 'Explore how geography becomes a political project.' }],
  CHN: [{ countryId: 'JPN', topicId: 'industry', connection: 'Look inside another East Asian industrial system.' }, { countryId: 'MYS', topicId: 'electronics', connection: 'Trace production beyond one country’s borders.' }],
  USA: [{ countryId: 'CHN', topicId: 'manufacturing', connection: 'Another kind of economic influence: production networks.' }, { countryId: 'BRA', topicId: 'agriculture', connection: 'How does land become a global economic resource?' }],
  FRA: [{ countryId: 'BRA', topicId: 'language', connection: 'Across the Atlantic, language carries a different colonial history.' }, { countryId: 'TUR', topicId: 'republic', connection: 'Another republic shaped by an imperial past.' }],
  IND: [{ countryId: 'IDN', topicId: 'language', connection: 'Another multilingual society, another approach to a shared language.' }, { countryId: 'BRA', topicId: 'amazon', connection: 'See how water connects nature to everyday life elsewhere.' }],
  MYS: [{ countryId: 'SGP', topicId: 'shipping', connection: 'Continue to the port at the peninsula’s southern tip.' }, { countryId: 'IDN', topicId: 'islands', connection: 'Borneo’s southern neighbor stretches across an archipelago.' }],
  IDN: [{ countryId: 'MYS', topicId: 'two-shores', connection: 'Follow Borneo north into a different federation.' }, { countryId: 'IND', topicId: 'languages', connection: 'Another large country brings many languages together.' }],
};
export function relatedStories(destination: Destination) {
  const trail = trails.find(t => t.stops.some(s => destinationKey(s) === destinationKey(destination)));
  const next = trail?.stops[(trail.stops.findIndex(s => destinationKey(s) === destinationKey(destination)) + 1) % trail.stops.length];
  const candidates = [...(next ? [next] : []), ...(related[destination.countryId] ?? [])];
  return candidates.filter((item, index) => item.countryId !== destination.countryId && candidates.findIndex(c => destinationKey(c) === destinationKey(item)) === index).slice(0, 2);
}

export const placeNotes: Record<string, string> = {
  'Malaysia': 'The peninsula lies north of Singapore. The federation also extends across the South China Sea to northern Borneo.',
  'Indonesia': 'A vast archipelago stretches south and east of Singapore, including Sumatra beside the Malacca Strait.',
  'Singapore': 'At the southern end of the Malay Peninsula, this island country sits beside a major passage between seas.',
  'Malacca Strait': 'The passage between Sumatra and the Malay Peninsula leads toward the Singapore Strait and South China Sea.',
  'South China Sea': 'This sea links the shores of mainland Southeast Asia, Borneo, and the Philippines with East Asian sea routes.',
  'Peninsular Malaysia': 'Malaysia’s western region shares a land border with Thailand. Singapore lies at its southern tip.',
  'Borneo': 'One island, three countries: Indonesia, Malaysia, and Brunei. Its outline does not follow a single national border.',
  'Sabah': 'The northeastern part of Malaysian Borneo, across the South China Sea from the peninsula.',
  'Sarawak': 'A Malaysian state along northern Borneo, with its own regional history and diverse communities.',
  'Sumatra': 'A long Indonesian island on the southern side of the Malacca Strait.',
  'Java': 'An Indonesian island southeast of Sumatra, with a dense network of settlements and economic activity.',
  'Sulawesi': 'An Indonesian island east of Borneo, part of the archipelago’s varied ecological and cultural geography.',
  'New Guinea': 'The island is shared by Indonesia in the west and Papua New Guinea in the east.',
  'Bosphorus': 'This narrow strait connects the Black Sea with the Sea of Marmara. The route onward passes through the Dardanelles.',
  'Black Sea': 'A ship leaving this sea for the Mediterranean must pass through the Turkish Straits.',
  'Amazon Basin': 'A river basin crossing several South American countries. Forests, rivers, and atmospheric moisture form a connected system.',
  'Amazon': 'The forest and river system extends beyond Brazil. A national boundary does not contain its water cycle.',
  'Cerrado': 'A distinct tropical savanna region south and east of the Amazon. Agricultural expansion affects both landscapes differently.',
  'French Guiana': 'On South America’s Atlantic coast, this territory is part of France. The familiar European outline is incomplete.',
  'Mississippi Basin': 'An interior river network connecting large areas of the United States to the Gulf of Mexico.',
  'Himalayas': 'This mountain system marks the northern edge of the Indian subcontinent and interacts with moisture-bearing winds.',
  'Tibetan Plateau': 'High terrain in western China contrasts with the densely settled eastern plains.',
  'Eastern plains': 'Low-lying eastern regions and river basins have long supported farming and large settlements.',
  'Pacific coast': 'Much of Japan’s urban and industrial activity follows the coastal plains facing the Pacific.',
};
export function linkedCountry(place: Place) { return countries.find(country => country.name === place.name); }

const aliases: Record<string, string> = { SGP: '新加坡 rich wealthy wealth port shipping 华人 富有 航运', CHN: '中国 china manufacturing 工厂 制造', USA: '美国 usa america us dollar 美元', JPN: '日本 japan aging aged ageing old 老龄化', TUR: '土耳其 türkiye turkey strait 海峡', BRA: '巴西 brasil brazil rainforest amazon 亚马逊', FRA: '法国 france french', IND: '印度 india monsoon 季风', MYS: '马来西亚 malaysia chips semiconductors', IDN: '印尼 印度尼西亚 indonesia islands' };
const stopWords = new Set(['why', 'how', 'what', 'does', 'did', 'is', 'a', 'an', 'the', 'so', 'of', 'in', 'to', 'are', 'do', 'can', 'become', 'it']);
export type SearchResult = { destination: Destination; title: string; subtitle: string; kind: 'story' | 'country' | 'map'; score: number };
export function searchAtlas(query: string, countryId?: string, locale: Locale = 'en'): SearchResult[] {
  const tokens = query.toLowerCase().replace(/[?？.,!]/g, '').split(/\s+/).filter(t => t && !stopWords.has(t));
  const match = (value: string) => tokens.reduce((score, token) => score + (value.toLowerCase().includes(token) ? 1 : 0), 0);
  if (!tokens.length) return [];
  const results: SearchResult[] = [];
  for (const country of directory) {
    const profile = getCountry(country.id);
    const countryScore = match(`${country.name} ${countryBasics[country.id]?.nameZh ?? ''} ${country.id} ${aliases[country.id] ?? ''}`);
    if (countryScore) results.push({ destination: { countryId: country.id }, title: countryName(country.id, country.name, locale), subtitle: `${regionName(country.region, locale)} · ${locale === 'zh' ? profile ? '编辑概览' : '基础概览' : profile ? 'Country story' : 'Basic overview'}`, kind: profile ? 'country' : 'map', score: countryScore * 4 });
    profile?.topics.forEach((topic, index) => {
      const topicScore = match(`${chineseProfiles[country.id]?.topics[index]?.join(' ') ?? ''} ${topic.title} ${topic.category} ${topic.intro} ${topic.sections.map(s => s.text).join(' ')}`);
      if (topicScore || countryScore) results.push({ destination: topicDestination(profile, index), title: topicLabel(profile, topic, locale), subtitle: `${countryName(country.id, profile.name, locale)} · ${locale === 'zh' ? '编辑问题' : topic.category}`, kind: 'story', score: topicScore * 3 + countryScore + (country.id === countryId ? 2 : 0) });
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 16);
}
