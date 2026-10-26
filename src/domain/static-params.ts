import { countries } from '@/content/legacy/data';
import { directory } from './catalog';
import { countrySlug, storySlug } from './slugs';

/** One route segment per country and territory on the map. */
export function countryStaticParams(): { country: string }[] {
  return directory.map((item) => ({ country: countrySlug(item.id) }));
}

/** One route per answered question. */
export function storyStaticParams(): { country: string; story: string }[] {
  return countries.flatMap((country) =>
    country.topics.map((topic) => ({
      country: countrySlug(country.id),
      story: storySlug(topic.id),
    })),
  );
}
