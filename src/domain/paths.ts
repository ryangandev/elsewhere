/**
 * Paths are the source of truth for where the reader is:
 *   /                      the world
 *   /<country>             a country overview
 *   /<country>/<story>     one question, optionally `?trail=<trail id>`
 *
 * Paths are built on the server, while pages and client indexes are generated. The browser
 * receives finished paths and never builds one from IDs.
 */
import 'server-only';
import type { Destination } from './destination';
import { countrySlug, storySlug } from './slugs';

export function destinationPath(destination: Destination | null): string {
  if (!destination) return '/';
  let path = `/${countrySlug(destination.countryId)}`;
  if (destination.storyId) path += `/${storySlug(destination.countryId, destination.storyId)}`;
  if (destination.storyId && destination.trailId) {
    path += `?${new URLSearchParams({ trail: destination.trailId })}`;
  }
  return path;
}
