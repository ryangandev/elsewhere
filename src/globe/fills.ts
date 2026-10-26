import { BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ConicPolygonGeometry from 'three-conic-polygon-geometry';
import type { CountryFeature } from './cartography';

// Lazy country caps: one draw per identity, including all its islands and holes.
// A bounded cache avoids retaining meshes for every place visited in a long session.
export function createCountryFills(radius: number) {
  const group = new Group();
  const empty = new BufferGeometry();
  const hoverMaterial = new MeshBasicMaterial({ color: '#f2ddb0', transparent: true, opacity: .3, depthWrite: false });
  const selectedMaterial = new MeshBasicMaterial({ color: '#e5ca85', transparent: true, opacity: .28, depthWrite: false });
  const hover = new Mesh(empty, hoverMaterial), selected = new Mesh(empty, selectedMaterial);
  hover.visible = selected.visible = false;
  group.add(hover, selected);
  let features = new Map<string, CountryFeature>();
  const cache = new Map<string, BufferGeometry>();
  const clear = () => { hover.geometry = selected.geometry = empty; hover.visible = selected.visible = false; for (const geometry of cache.values()) geometry.dispose(); cache.clear(); };
  const geometryFor = (id?: string) => {
    if (!id || !features.has(id)) return empty;
    const cached = cache.get(id);
    if (cached) { cache.delete(id); cache.set(id, cached); return cached; }
    const feature = features.get(id)!;
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const caps = polygons.map(polygon => new ConicPolygonGeometry(polygon, 0, radius, false, true, false, 1.5));
    const result = mergeGeometries(caps, false);
    for (const cap of caps) cap.dispose();
    if (!result) return empty;
    result.computeBoundingSphere();
    cache.set(id, result);
    return result;
  };
  return {
    group,
    setFeatures(items: CountryFeature[]) { clear(); features = new Map(items.map(item => [item.properties.ADM0_A3, item])); },
    highlight(selectedId?: string, hoveredId?: string) {
      selected.geometry = geometryFor(selectedId);
      hover.geometry = hoveredId === selectedId ? empty : geometryFor(hoveredId);
      selected.visible = selected.geometry !== empty;
      hover.visible = hover.geometry !== empty;
      while (cache.size > 16) {
        const oldest = [...cache.keys()].find(id => id !== selectedId && id !== hoveredId);
        if (!oldest) break;
        cache.get(oldest)!.dispose(); cache.delete(oldest);
      }
    },
    dispose() { clear(); features.clear(); empty.dispose(); hoverMaterial.dispose(); selectedMaterial.dispose(); group.removeFromParent(); },
  };
}
