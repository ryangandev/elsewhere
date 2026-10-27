import { expectAnswer, globeRegion } from './atlas';
import { getStory, storyPath } from './content';
import { expect, test } from './fixtures';

// Every spec runs with the production headers from vercel.json (see ./fixtures.ts) and fails on
// a Content Security Policy violation. This one makes sure the headers are really there, and
// that the globe, its image basemap and its geometry load under them.
test('pages carry the production security headers, and the globe draws under them', async ({
  page,
}) => {
  const story = getStory('SGP', 'shipping');
  const response = await page.goto(storyPath(story));

  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');

  await expectAnswer(page, story);
  await expect(globeRegion(page).locator('canvas')).toBeVisible();
  await page.waitForLoadState('networkidle');
});
