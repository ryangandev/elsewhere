import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCountries, listStories } from '@/content';
import { buildRobots, buildSitemap, pageMetadata, siteOrigin } from '@/domain/site';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('site origin', () => {
  it('is the production domain Vercel provides, and the local server elsewhere', () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
    expect(siteOrigin().href).toBe('http://localhost:3000/');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'elsewhere.example');
    expect(siteOrigin().href).toBe('https://elsewhere.example/');
    expect(buildRobots().sitemap).toBe('https://elsewhere.example/sitemap.xml');
  });
});

describe('sitemap', () => {
  it('lists the home page and every published country and question, once each', () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'elsewhere.example');
    const urls = buildSitemap().map((entry) => entry.url);
    expect(urls).toHaveLength(1 + listCountries().length + listStories().length);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain('https://elsewhere.example/');
    expect(urls).toContain('https://elsewhere.example/singapore');
    expect(urls).toContain('https://elsewhere.example/singapore/shipping');
    // Map-only countries hold no edited content.
    expect(urls).not.toContain('https://elsewhere.example/canada');
  });
});

describe('page metadata', () => {
  it('gives every page a canonical path and a complete link preview', () => {
    expect(
      pageMetadata({ path: '/singapore/shipping', title: 'Shipping', description: 'Why.' }),
    ).toMatchObject({
      title: 'Shipping',
      alternates: { canonical: '/singapore/shipping' },
      openGraph: { url: '/singapore/shipping', siteName: 'Elsewhere', title: 'Shipping' },
    });
  });
});
