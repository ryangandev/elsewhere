import { readFileSync } from 'node:fs';
import { expect, test as base } from '@playwright/test';
import { getTransformedRoutes, type RouteWithSrc } from '@vercel/routing-utils';

/**
 * The response headers Vercel adds to a path, from vercel.json compiled the way Vercel compiles
 * it. `npx serve` does not read vercel.json, so the tests add them to every page themselves.
 */
const headerRoutes = (
  getTransformedRoutes(JSON.parse(readFileSync('vercel.json', 'utf8'))).routes ?? []
)
  .filter((route): route is RouteWithSrc => 'src' in route)
  .filter((route) => route.continue && route.headers && !route.status)
  .map((route) => ({ src: new RegExp(route.src), headers: route.headers ?? {} }));

export function vercelHeaders(pathname: string): Record<string, string> {
  return Object.assign(
    {},
    ...headerRoutes.filter((route) => route.src.test(pathname)).map((route) => route.headers),
  );
}

/**
 * The tests' `test`: the same as Playwright's, with the site's production response headers on
 * every page, and a check that no page throws an uncaught error or breaks its Content Security
 * Policy. Other console messages are ignored; WebGL drivers log plenty of warnings.
 */
export const test = base.extend<{ pageErrors: Error[]; policyViolations: string[] }>({
  page: async ({ page }, provide) => {
    await page.route(
      () => true,
      async (route) => {
        if (route.request().resourceType() !== 'document') return route.fallback();
        const response = await route.fetch();
        const { pathname } = new URL(route.request().url());
        await route.fulfill({
          response,
          headers: { ...response.headers(), ...vercelHeaders(pathname) },
        });
      },
    );
    await provide(page);
  },
  pageErrors: [
    async ({ page }, use) => {
      const errors: Error[] = [];
      page.on('pageerror', (error) => errors.push(error));
      await use(errors);
      expect(errors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
  policyViolations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
          violations.push(message.text());
        }
      });
      await use(violations);
      expect(violations, 'Content Security Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
