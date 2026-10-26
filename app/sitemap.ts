import type { MetadataRoute } from 'next';
import { buildSitemap } from '@/domain/site';

// Written to out/sitemap.xml at build time: every published country and question.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap();
}
