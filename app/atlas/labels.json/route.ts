import { buildCountryLabels } from '@/domain/client-indexes';

// Globe country labels, generated at build time and served as a static file.
// See src/domain/atlas-index.ts.
export const dynamic = 'force-static';

export function GET() {
  return Response.json(buildCountryLabels());
}
