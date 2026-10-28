// vercel.json, checked the way Vercel reads it: compiled to routes with Vercel's own routing
// utilities, then matched like a request. See docs/architecture.md#platform.
import assert from 'node:assert/strict';
import { getTransformedRoutes, type HasField, type Route } from '@vercel/routing-utils';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { createContentStore, listMapCountries, publishedContent } from '@/content';
import { readContentTree } from '@/content/files';
import { buildLegacyRedirects } from '@/domain/legacy-redirects';
import { destinationPath } from '@/domain/paths';
import { PROTOTYPE_QUESTIONS, PROTOTYPE_TRAILS } from '@/domain/prototype-urls';

// Vercel rejects a vercel.json with more redirects than this.
const MAX_REDIRECTS = 2048;

const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
const compiled = getTransformedRoutes(config);
const routes: Route[] = compiled.routes ?? [];

type Condition = HasField[number];

/**
 * Only the unambiguous matchable-value forms are allowed, so this matcher and Vercel agree.
 * A plain string value is a regex whose anchoring is not documented.
 */
function conditionHolds(condition: Condition, url: URL): boolean {
  if (condition.type !== 'query') throw new Error(`Unexpected ${condition.type} condition`);
  const actual = url.searchParams.get(condition.key);
  if (actual === null) return false;
  const expected = condition.value;
  if (expected === undefined) return true;
  if (typeof expected !== 'object') throw new Error('Use { eq } or { re } for query values');
  for (const [operator, operand] of Object.entries(expected)) {
    if (operator === 'eq' && actual !== operand) return false;
    if (operator === 're' && !new RegExp(String(operand)).test(actual)) return false;
    if (operator !== 'eq' && operator !== 're') throw new Error(`Unexpected ${operator} match`);
  }
  return true;
}

/** The redirect Vercel answers a request with, or null when the request reaches the files. */
function redirectFor(
  path: string,
  routeList: Route[] = routes,
): { status: number; location: string } | null {
  const url = new URL(path, 'https://elsewhere.test');
  for (const route of routeList) {
    if ('handle' in route) break;
    if (!new RegExp(route.src).test(url.pathname)) continue;
    if (!(route.has ?? []).every((condition) => conditionHolds(condition, url))) continue;
    if (route.continue) continue;
    const location = route.headers?.Location;
    if (route.status && location) return { status: route.status, location };
  }
  return null;
}

const location = (path: string) => redirectFor(path)?.location ?? null;

test('vercel.json compiles, within Vercel limits', () => {
  assert.equal(compiled.error, null);
  assert.ok(config.redirects.length <= MAX_REDIRECTS);
});

test('the committed redirects are current (run npm run redirects:build)', () => {
  assert.deepEqual(config.redirects, buildLegacyRedirects());
});

test('prototype query URLs redirect permanently to path URLs', () => {
  assert.deepEqual(redirectFor('/?country=sgp&topic=shipping'), {
    status: 308,
    location: '/singapore/shipping',
  });
  assert.equal(
    location('/?country=sgp&topic=shipping&trail=water-connects'),
    '/singapore/shipping?trail=water-connects',
  );
  assert.equal(
    location('/?trail=water-connects&topic=shipping&country=sgp'),
    location('/?country=sgp&topic=shipping&trail=water-connects'),
  );
  assert.equal(location('/?country=sgp'), '/singapore');
  // The prototype read the country in any case.
  assert.equal(location('/?country=SGP'), '/singapore');
  assert.equal(location('/?country=Sgp&topic=shipping'), '/singapore/shipping');
});

test('prototype query URLs degrade to the nearest page that still exists', () => {
  // A question the country does not have opens the country; so does a map-only country.
  assert.equal(location('/?country=jpn&topic=shipping'), '/japan');
  assert.equal(location('/?country=can&topic=shipping'), '/canada');
  // Values match whole: "languages" is India's question, not a longer spelling of Brazil's.
  assert.equal(location('/?country=bra&topic=languages'), '/brazil');
  // A trail the question is not a stop of is dropped.
  assert.equal(location('/?country=sgp&topic=wealth&trail=water-connects'), '/singapore/wealth');
  assert.equal(location('/?country=sgp&topic=shipping&trail=made-together'), '/singapore/shipping');
});

test('anything else is not redirected', () => {
  assert.equal(redirectFor('/?country=unknown&topic=shipping'), null);
  assert.equal(redirectFor('/?country=sgpx'), null);
  assert.equal(redirectFor('/?topic=shipping'), null);
  assert.equal(redirectFor('/'), null);
  assert.equal(redirectFor('/?other=1'), null);
  assert.equal(redirectFor('/singapore?country=jpn'), null);
  assert.equal(redirectFor('/singapore/shipping?trail=water-connects'), null);
});

test('every prototype destination redirects to its page, or its country while unpublished', () => {
  for (const country of listMapCountries()) {
    const id = country.id.toLowerCase();
    assert.equal(location(`/?country=${id}`), destinationPath({ countryId: country.id }));
  }
  for (const [countryId, storyIds] of Object.entries(PROTOTYPE_QUESTIONS)) {
    for (const storyId of storyIds) {
      assert.equal(
        location(`/?country=${countryId.toLowerCase()}&topic=${storyId}`),
        publishedContent.getStory(countryId, storyId)
          ? destinationPath({ countryId, storyId })
          : destinationPath({ countryId }),
      );
    }
  }
  const trails = publishedContent
    .listTrails()
    .filter((trail) => PROTOTYPE_TRAILS.includes(trail.id));
  for (const trail of trails) {
    for (const { countryId, storyId } of trail.stops) {
      if (!PROTOTYPE_QUESTIONS[countryId]?.includes(storyId)) continue;
      const query = `country=${countryId.toLowerCase()}&topic=${storyId}&trail=${trail.id}`;
      assert.equal(
        location(`/?${query}`),
        destinationPath({ countryId, storyId, trailId: trail.id }),
      );
    }
  }
});

test('the rules follow production content, whatever NODE_ENV the builder runs under', () => {
  // Under Vitest NODE_ENV is "test", where the loaders show drafts; the rules never do.
  assert.deepEqual(
    buildLegacyRedirects(),
    buildLegacyRedirects(
      createContentStore(readContentTree('content/en'), { includeDrafts: false }),
    ),
  );

  // Singapore's shipping question reopened by review: a draft, which production does not build.
  const dir = mkdtempSync(join(tmpdir(), 'elsewhere-redirects-'));
  try {
    cpSync('content/en', dir, { recursive: true });
    const file = join(dir, 'countries', 'singapore.json');
    const singapore = JSON.parse(readFileSync(file, 'utf8'));
    const shipping = singapore.stories.find((story: { id: string }) => story.id === 'shipping');
    const { reviewedBy, reviewedAt, ...provenance } = shipping.provenance;
    shipping.provenance = {
      ...provenance,
      status: 'draft',
      revision: {
        notes: 'Cite pages that state it.',
        requestedBy: 'Tester',
        requestedAt: '2026-10-28',
        reopened: { reviewedBy, reviewedAt },
      },
    };
    writeFileSync(file, JSON.stringify(singapore, null, 2));
    const tree = readContentTree(dir);
    const redirects = buildLegacyRedirects(createContentStore(tree, { includeDrafts: false }));
    const withDrafts = buildLegacyRedirects(createContentStore(tree, { includeDrafts: true }));
    // The question rule and its trail-stop rule are left out.
    assert.equal(withDrafts.length - redirects.length, 2);
    assert.ok(
      !redirects.some((rule) => rule.destination.startsWith('/singapore/shipping')),
      'no rule points at the unpublished page',
    );
    const reopened = getTransformedRoutes({ ...config, redirects }).routes ?? [];
    // Its prototype URLs open the country page instead, with or without the trail.
    assert.equal(redirectFor('/?country=sgp&topic=shipping', reopened)?.location, '/singapore');
    assert.equal(
      redirectFor('/?country=sgp&topic=shipping&trail=water-connects', reopened)?.location,
      '/singapore',
    );
    assert.equal(
      redirectFor('/?country=sgp&topic=wealth', reopened)?.location,
      '/singapore/wealth',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
