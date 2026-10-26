import type { Object3D } from 'three';
import { createCountryBorders } from './borders';
import type { CountryFeature } from './cartography';
import { createCountryLookup } from './country-lookup';
import { createCountryFills, type HighlightRoles } from './fills';

// Slightly above the globe surface (radius 100) so overlays never z-fight with the image.
const BORDER_RADIUS = 100.12;
const FILL_RADIUS = 100.15;
// Detailed geometry loads once the camera is close enough for it to be visible.
const DETAIL_ALTITUDE = 1.1;

type GeographyOptions = {
  scene: Object3D;
  features: CountryFeature[];
  loadDetail: () => Promise<CountryFeature[]>;
  onFeaturesChange: () => void;
};

// Country geometry and everything derived from it: borders, fills, and picking.
// Base geometry renders first; detailed geometry replaces it when zoomed in.
export function createGeography({
  scene,
  features,
  loadDetail,
  onFeaturesChange,
}: GeographyOptions) {
  const borders = createCountryBorders(BORDER_RADIUS);
  const fills = createCountryFills(FILL_RADIUS);
  scene.add(borders.group, fills.group);
  let byId = new Map<string, CountryFeature>();
  let lookup = createCountryLookup([]);
  let selectedId: string | undefined;
  let hoveredId: string | undefined;
  let detailRequested = false;
  let disposed = false;

  const repaint = () => {
    borders.highlight(selectedId, hoveredId);
    fills.highlight(selectedId, hoveredId);
  };
  const setFeatures = (items: CountryFeature[]) => {
    byId = new Map(items.map((feature) => [feature.properties.ADM0_A3, feature]));
    lookup = createCountryLookup(items);
    borders.setFeatures(items);
    fills.setFeatures(items);
    repaint();
    onFeaturesChange();
  };
  setFeatures(features);

  return {
    get features(): ReadonlyMap<string, CountryFeature> {
      return byId;
    },
    countryAt(point: { lat: number; lng: number } | null) {
      return lookup(point);
    },
    setSelected(id: string | undefined) {
      if (selectedId === id) return;
      selectedId = id;
      repaint();
    },
    setHovered(id: string | undefined) {
      if (hoveredId === id) return;
      hoveredId = id;
      repaint();
    },
    setRoles(roles: HighlightRoles) {
      borders.setRoles(roles);
      fills.setRoles(roles);
    },
    refine(altitude: number) {
      if (disposed || detailRequested || altitude > DETAIL_ALTITUDE) return;
      detailRequested = true;
      loadDetail()
        .then((items) => {
          if (!disposed) setFeatures(items);
        })
        .catch(() => {
          // Base geometry stays complete and pickable if refinement is unavailable.
        });
    },
    dispose() {
      disposed = true;
      borders.dispose();
      fills.dispose();
    },
  };
}

export type Geography = ReturnType<typeof createGeography>;
