import { geoArea, geoBounds, geoContains } from 'd3-geo';
import type { CountryFeature } from './cartography';

// Bounds reject most countries before the more expensive spherical containment test.
// Longitude intervals that cross the date line wrap rather than spanning the world.
export function createCountryLookup(features: CountryFeature[]) {
  const entries = features.map(feature => ({ feature, bounds: geoBounds(feature), area: geoArea(feature) }))
    .sort((a, b) => a.area - b.area);
  return (point: { lat: number; lng: number } | null) => {
    if (!point) return undefined;
    const { lat, lng } = point;
    return entries.find(({ feature, bounds: [[west, south], [east, north]] }) =>
      lat >= south && lat <= north && (west <= east ? lng >= west && lng <= east : lng >= west || lng <= east)
      && geoContains(feature, [lng, lat]))?.feature;
  };
}
