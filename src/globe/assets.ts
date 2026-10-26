import type { CountryFeature } from './cartography';

export type AtlasGlobeAssets = {
  // Equirectangular Earth image; the measured default is the 4096 x 2048 Blue Marble.
  basemap: string;
  // Base country geometry, loaded before the globe appears.
  countries: string;
  // Detailed country geometry, loaded when the camera first zooms close.
  countriesDetail: string;
};

// The bundled assets in public/maps.
export const DEFAULT_GLOBE_ASSETS: AtlasGlobeAssets = {
  basemap: '/maps/earth.jpg',
  countries: '/maps/countries.geojson',
  countriesDetail: '/maps/countries-detail.geojson',
};

const GEOMETRY_TIMEOUT_MS = 18000;

export async function fetchCountries(url: string, signal: AbortSignal): Promise<CountryFeature[]> {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(GEOMETRY_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error(`Map geometry unavailable: ${url} (${response.status})`);
  const collection = (await response.json()) as { features: CountryFeature[] };
  return collection.features;
}
