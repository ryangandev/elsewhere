import { countries, type Country, type Place } from '@/content/legacy/data';
import basics from '@/content/legacy/country-basics.json';
import mapIndex from '@/content/legacy/country-index.json';

export type MapCountry = { id: string; name: string; region: string; lat: number; lng: number };

export type CountryBasics = {
  region: string;
  continent: string;
  type: string;
  population: number | null;
  populationYear: number | null;
};

export const countryBasics: Record<string, CountryBasics> = basics;

/** Every country and territory on the map, edited or not, sorted by name. */
export const directory: MapCountry[] = [
  ...mapIndex.filter((item) => !countries.some((country) => country.id === item.id)),
  ...countries.map(({ id, name, region, lat, lng }) => ({ id, name, region, lat, lng })),
].sort((a, b) => a.name.localeCompare(b.name));

/** Question IDs per edited country. IDs are permanent and independent of title and order. */
export const topicIds: Record<string, string[]> = Object.fromEntries(
  countries.map((country) => [country.id, country.topics.map((topic) => topic.id)]),
);

export function getMapCountry(id?: string): MapCountry | undefined {
  return directory.find((item) => item.id === id);
}

export function getCountry(id?: string): Country | undefined {
  return countries.find((country) => country.id === id);
}

/** The edited country whose name matches a map place, if any. */
export function linkedCountry(place: Place): Country | undefined {
  return countries.find((country) => country.name === place.name);
}

/** The three edited countries closest to a place, by great-circle distance. */
export function nearbyCountries(place: MapCountry): Country[] {
  // The haversine form also behaves correctly across the antimeridian.
  const rad = Math.PI / 180;
  const distance = (country: Country) =>
    Math.sin(((country.lat - place.lat) * rad) / 2) ** 2 +
    Math.cos(place.lat * rad) *
      Math.cos(country.lat * rad) *
      Math.sin(((country.lng - place.lng) * rad) / 2) ** 2;
  return countries
    .filter((country) => country.id !== place.id)
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, 3);
}
