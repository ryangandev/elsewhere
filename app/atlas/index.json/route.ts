import { buildAtlasIndex } from '@/domain/client-indexes';

// The search and title index (countries, questions, trails), generated at build time and served
// as a static file. The browser loads it on demand. See src/domain/atlas-index.ts.
export const dynamic = 'force-static';

export function GET() {
  return Response.json(buildAtlasIndex());
}
