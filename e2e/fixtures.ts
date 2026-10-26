import { expect, test as base } from '@playwright/test';

/**
 * The tests' `test`: the same as Playwright's, plus a check that no page throws an uncaught
 * error. Console warnings are ignored; WebGL drivers log plenty of them.
 */
export const test = base.extend<{ pageErrors: Error[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: Error[] = [];
      page.on('pageerror', (error) => errors.push(error));
      await use(errors);
      expect(errors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
