/**
 * Where the site lives and how its pages present themselves to search engines and link
 * previews: canonical links, Open Graph, robots.txt and the sitemap. Runs at build time.
 */
import 'server-only';
import type { Metadata, MetadataRoute } from 'next';
import { listCountries, listStories, type Provenance } from '@/content';
import { destinationPath } from './paths';

export const SITE_NAME = 'Elsewhere';
export const SITE_TITLE = 'Elsewhere | A wider world';
export const SITE_DESCRIPTION =
  'Start with a question. See the answer on the map. Follow it somewhere new. A question-first atlas on an interactive 3D globe.';

/** Serves `out/` locally (`npm start`). */
const LOCAL_ORIGIN = 'http://localhost:3000';

/**
 * The public origin absolute URLs are built on. On Vercel it is the production domain, which
 * Vercel sets for every deployment (previews included, so their canonical links point at
 * production) without any configuration; it changes when a custom domain is added, on the next
 * deployment. Anywhere else it is the local server.
 */
export function siteOrigin(): URL {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return new URL(host ? `https://${host}` : LOCAL_ORIGIN);
}

/**
 * Metadata for one page: its canonical path and its link preview. Next.js replaces `openGraph`
 * as a whole rather than merging it with the layout's, so every page sets all of it here.
 */
export function pageMetadata(page: {
  path: string;
  title?: string;
  description: string;
  type?: 'website' | 'article';
}): Metadata {
  return {
    ...(page.title ? { title: page.title } : {}),
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: {
      title: page.title ?? SITE_TITLE,
      description: page.description,
      url: page.path,
      siteName: SITE_NAME,
      type: page.type ?? 'website',
    },
  };
}

const reviewedOn = (provenance: Provenance) => provenance.reviewedAt ?? provenance.generatedAt;

/**
 * The pages worth indexing: the home page and every published country and question. Map-only
 * countries are left out; they hold Natural Earth basics rather than edited content. Production
 * builds publish reviewed content only, so drafts never appear here.
 */
export function buildSitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => new URL(path, siteOrigin()).href;
  return [
    { url: url('/') },
    ...listCountries().map((country) => ({
      url: url(destinationPath({ countryId: country.id })),
      lastModified: reviewedOn(country.provenance),
    })),
    ...listStories().map((story) => ({
      url: url(destinationPath({ countryId: story.countryId, storyId: story.id })),
      lastModified: reviewedOn(story.provenance),
    })),
  ];
}

export function buildRobots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: new URL('/sitemap.xml', siteOrigin()).href,
  };
}
