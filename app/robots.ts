import type { MetadataRoute } from 'next';
import { buildRobots } from '@/domain/site';

// Written to out/robots.txt at build time. Vercel adds a noindex header to preview deployments.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return buildRobots();
}
