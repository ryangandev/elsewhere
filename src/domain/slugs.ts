/**
 * The only place that maps between permanent content IDs and URL slugs.
 * Routes, links, and static params all go through these functions, so a future slug scheme
 * (for example readable country names) changes here and nowhere else.
 */

export function countrySlug(countryId: string): string {
  return countryId.toLowerCase();
}

export function countryIdFromSlug(slug: string): string {
  return slug.toUpperCase();
}

export function storySlug(topicId: string): string {
  return topicId;
}

export function topicIdFromSlug(slug: string): string {
  return slug;
}
