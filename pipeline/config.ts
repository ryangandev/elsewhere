// Shared settings for the content pipeline. See docs/architecture.md#content-pipeline.
import { existsSync } from 'node:fs';

/** The English content tree that drafts are written to. */
export const DEFAULT_CONTENT_DIR = 'content/en';

/** Git-ignored working state: URL check cache, batch run state, failed drafts, recordings. */
export const CACHE_DIR = 'pipeline/.cache';

export const BATCHES_DIR = 'pipeline/batches';

/** Geo data the pipeline reads; never written by the pipeline. */
export const GAZETTEER_FILE = 'data/geo/gazetteer.json';
export const MAP_COUNTRIES_FILE = 'data/geo/countries.json';
/** Sea routes are checked against the detailed geometry the globe draws. */
export const LAND_GEOMETRY_FILE = 'public/maps/countries-detail.geojson';

/** The country file shown to the model as the quality and shape reference. */
export const REFERENCE_COUNTRY_FILE = 'content/en/countries/singapore.json';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** Research and sourcing is intelligence-sensitive work; Opus 5.5 defaults to medium. */
export const DEFAULT_EFFORT: Effort = 'high';

export type GenerationLimits = {
  /** Web searches per request; the server tool loop counts them per API call. */
  webSearchesPerRequest: number;
  webFetchesPerRequest: number;
  /** Times a submitted draft may fail validation before the country fails. */
  repairAttempts: number;
  /** Server tool loops that hit their iteration limit (`pause_turn`) and are resumed. */
  continuations: number;
  /** Reminders when the model ends its turn without submitting. */
  nudges: number;
  /** Requests per country in total; a backstop against loops. */
  requests: number;
  maxTokens: number;
};

export const DEFAULT_LIMITS: GenerationLimits = {
  webSearchesPerRequest: 12,
  webFetchesPerRequest: 16,
  repairAttempts: 3,
  continuations: 6,
  nudges: 2,
  requests: 24,
  maxTokens: 64000,
};

/** Stories per country, from docs/status.md (pilot batch decision). */
export const STORIES_PER_COUNTRY = { min: 4, max: 6 };

/**
 * Load a git-ignored `.env.local` (then `.env`) into process.env without overriding variables
 * that are already set. Keys are never printed.
 */
export function loadLocalEnv(): void {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

/** Today as YYYY-MM-DD in UTC; the pipeline's notion of "when a source was read". */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
