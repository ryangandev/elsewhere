/**
 * Permanent redirects for the prototype's query-string URLs, which addressed destinations as
 * `/?country=sgp&topic=shipping&trail=water-connects`. They are served by Vercel (`redirects` in
 * vercel.json, written by `npm run redirects:build`), because a static page cannot see the query
 * string of the request that loaded it. See docs/architecture.md#platform.
 *
 * The prototype could only name the questions and trails in prototype-urls.ts, a frozen set.
 * Map identities are not listed there, because the map has the same 258 identities the prototype
 * had. Destinations are built from permanent IDs through
 * `destinationPath`, so they follow slug changes when the file is regenerated.
 *
 * Rules are built from the content a production build publishes (`publishedContent`), whatever
 * NODE_ENV the builder runs under, so a question that is a draft in production (one review
 * reopened, for example) gets no rule of its own and falls through to its country, instead of
 * pointing at a page production never builds.
 */
import 'server-only';
import { listMapCountries, publishedContent, type ContentStore } from '@/content';
import { destinationPath } from './paths';
import { PROTOTYPE_QUESTIONS, PROTOTYPE_TRAILS } from './prototype-urls';

/** A `has` condition on one query parameter, in Vercel's matchable-value form. */
export type QueryCondition = {
  type: 'query';
  key: 'country' | 'topic' | 'trail';
  value: { eq: string } | { re: string };
};

/** One entry of `redirects` in vercel.json. */
export type VercelRedirect = {
  source: '/';
  has: QueryCondition[];
  destination: string;
  permanent: true;
};

/**
 * The prototype read the country case-insensitively (`sgp` and `SGP` both worked) and wrote it in
 * lower case. Character classes keep that without depending on inline regex flags.
 */
function countryCondition(countryId: string): QueryCondition {
  const pattern = [...countryId].map((c) => `[${c.toLowerCase()}${c.toUpperCase()}]`).join('');
  return { type: 'query', key: 'country', value: { re: `^${pattern}$` } };
}

const exactly = (key: 'topic' | 'trail', value: string): QueryCondition => ({
  type: 'query',
  key,
  value: { eq: value },
});

const redirect = (has: QueryCondition[], destination: string): VercelRedirect => ({
  source: '/',
  has,
  destination,
  permanent: true,
});

/**
 * Vercel applies the first redirect that matches, so the most specific come first:
 *   1. a question reached on a trail it is still a stop of keeps the trail;
 *   2. any other question drops the trail;
 *   3. any other country URL (an unknown question, or no question) opens the country.
 * A question that no longer exists or is not published falls through to its country, whose page
 * production always builds (every map identity has one); a country that left the map gets no
 * redirect and the home page loads.
 */
export function buildLegacyRedirects(
  content: Pick<ContentStore, 'getStory' | 'listTrails'> = publishedContent,
): VercelRedirect[] {
  const trailStops: VercelRedirect[] = [];
  const questions: VercelRedirect[] = [];

  for (const [countryId, storyIds] of Object.entries(PROTOTYPE_QUESTIONS)) {
    for (const storyId of storyIds) {
      if (!content.getStory(countryId, storyId)) continue;
      const story = [countryCondition(countryId), exactly('topic', storyId)];
      for (const trail of content.listTrails()) {
        if (!PROTOTYPE_TRAILS.includes(trail.id)) continue;
        const onTrail = trail.stops.some(
          (stop) => stop.countryId === countryId && stop.storyId === storyId,
        );
        if (!onTrail) continue;
        trailStops.push(
          redirect(
            [...story, exactly('trail', trail.id)],
            destinationPath({ countryId, storyId, trailId: trail.id }),
          ),
        );
      }
      questions.push(redirect(story, destinationPath({ countryId, storyId })));
    }
  }

  const countries = listMapCountries().map((country) =>
    redirect([countryCondition(country.id)], destinationPath({ countryId: country.id })),
  );

  return [...trailStops, ...questions, ...countries];
}
