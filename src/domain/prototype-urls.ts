// What the prototype's query-string URLs could name, frozen: content added since never had a query
// URL. Vercel redirects these URLs (src/domain/legacy-redirects.ts), and a whole-country draft must
// keep every story ID listed here (pipeline/generate/check.ts), so the redirect keeps a page to
// point at. A plain module, so the content pipeline can import it outside a Next.js build.

/** The questions the prototype published, by country and story ID. */
export const PROTOTYPE_QUESTIONS: Readonly<Record<string, readonly string[]>> = {
  BRA: ['amazon', 'language', 'agriculture'],
  CHN: ['manufacturing', 'population', 'reforms'],
  FRA: ['paris', 'europe', 'overseas'],
  IDN: ['islands', 'language', 'nature'],
  IND: ['languages', 'monsoon', 'technology'],
  JPN: ['coasts', 'industry', 'aging'],
  MYS: ['two-shores', 'electronics', 'federation'],
  SGP: ['wealth', 'shipping', 'identity'],
  TUR: ['straits', 'republic', 'identity'],
  USA: ['dollar', 'geography', 'immigration'],
};

/** The trails the prototype published. */
export const PROTOTYPE_TRAILS: readonly string[] = [
  'water-connects',
  'made-together',
  'land-shapes-life',
];
