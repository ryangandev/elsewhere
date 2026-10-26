import { BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ConicPolygonGeometry from 'three-conic-polygon-geometry';
import type { CountryFeature } from './cartography';

export type HighlightRole = 'related' | 'contrast';
export type HighlightRoles = Record<HighlightRole, readonly string[]>;

const CACHE_LIMIT = 16;

function capGeometry(features: CountryFeature[], radius: number) {
  const caps = features.flatMap((feature) => {
    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    return polygons.map(
      (polygon) => new ConicPolygonGeometry(polygon, 0, radius, false, true, false, 1.5),
    );
  });
  const result = caps.length ? mergeGeometries(caps, false) : null;
  for (const cap of caps) cap.dispose();
  result?.computeBoundingSphere();
  return result;
}

// Lazy country caps: one draw per identity, including all its islands and holes.
// A bounded cache avoids retaining meshes for every place visited in a long session.
// Scene highlights get one merged draw per role, rebuilt only when the roles change.
export function createCountryFills(radius: number) {
  const group = new Group();
  const empty = new BufferGeometry();
  const material = (color: string, opacity: number) =>
    new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const hoverMaterial = material('#f2ddb0', 0.3);
  const selectedMaterial = material('#e5ca85', 0.28);
  const roleMaterials: Record<HighlightRole, MeshBasicMaterial> = {
    related: material('#e8d49a', 0.16),
    contrast: material('#9cc9dc', 0.2),
  };
  const hover = new Mesh(empty, hoverMaterial);
  const selected = new Mesh(empty, selectedMaterial);
  const roleMeshes: Record<HighlightRole, Mesh> = {
    related: new Mesh(empty, roleMaterials.related),
    contrast: new Mesh(empty, roleMaterials.contrast),
  };
  // Hover and selection draw over scene highlights.
  hover.renderOrder = selected.renderOrder = 1;
  for (const mesh of [hover, selected, roleMeshes.related, roleMeshes.contrast])
    mesh.visible = false;
  group.add(hover, selected, roleMeshes.related, roleMeshes.contrast);

  let features = new Map<string, CountryFeature>();
  let roles: HighlightRoles = { related: [], contrast: [] };
  const cache = new Map<string, BufferGeometry>();

  const setGeometry = (mesh: Mesh, geometry: BufferGeometry) => {
    mesh.geometry = geometry;
    mesh.visible = geometry !== empty;
  };
  const geometryFor = (id?: string) => {
    if (!id || !features.has(id)) return empty;
    const cached = cache.get(id);
    if (cached) {
      cache.delete(id);
      cache.set(id, cached);
      return cached;
    }
    const result = capGeometry([features.get(id)!], radius);
    if (!result) return empty;
    cache.set(id, result);
    return result;
  };
  const clearCache = () => {
    setGeometry(hover, empty);
    setGeometry(selected, empty);
    for (const geometry of cache.values()) geometry.dispose();
    cache.clear();
  };
  const rebuildRoles = () => {
    for (const role of ['related', 'contrast'] as const) {
      const mesh = roleMeshes[role];
      if (mesh.geometry !== empty) mesh.geometry.dispose();
      const items = roles[role].flatMap((id) => features.get(id) ?? []);
      setGeometry(mesh, capGeometry(items, radius) ?? empty);
    }
  };

  return {
    group,
    setFeatures(items: CountryFeature[]) {
      clearCache();
      features = new Map(items.map((item) => [item.properties.ADM0_A3, item]));
      rebuildRoles();
    },
    setRoles(next: HighlightRoles) {
      roles = { related: [...next.related], contrast: [...next.contrast] };
      rebuildRoles();
    },
    highlight(selectedId?: string, hoveredId?: string) {
      setGeometry(selected, geometryFor(selectedId));
      setGeometry(hover, hoveredId === selectedId ? empty : geometryFor(hoveredId));
      while (cache.size > CACHE_LIMIT) {
        const oldest = [...cache.keys()].find((id) => id !== selectedId && id !== hoveredId);
        if (!oldest) break;
        cache.get(oldest)!.dispose();
        cache.delete(oldest);
      }
    },
    dispose() {
      clearCache();
      roles = { related: [], contrast: [] };
      for (const mesh of Object.values(roleMeshes))
        if (mesh.geometry !== empty) mesh.geometry.dispose();
      features.clear();
      empty.dispose();
      for (const item of [hoverMaterial, selectedMaterial, ...Object.values(roleMaterials)])
        item.dispose();
      group.removeFromParent();
    },
  };
}
