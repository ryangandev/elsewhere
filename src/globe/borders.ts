import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Vector3,
} from 'three';
import type { CountryFeature } from './cartography';
import type { HighlightRole, HighlightRoles } from './fills';

// One draw for all borders, one per highlight role, and one each for the hovered and selected country.
// Keeping islands in these buffers avoids thousands of separate Three.js objects.
export function createCountryBorders(radius: number) {
  const group = new Group();
  const line = (color: string, opacity: number) =>
    new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const baseMaterial = line('#d9e6dd', 0.22);
  const hoverMaterial = line('#f5f6d9', 0.9);
  const selectedMaterial = line('#e5dda8', 1);
  const roleMaterials: Record<HighlightRole, LineBasicMaterial> = {
    related: line('#ece0b0', 0.6),
    contrast: line('#a9d6e6', 0.75),
  };
  const empty = new BufferGeometry();
  const base = new LineSegments(empty, baseMaterial);
  const hover = new LineSegments(empty, hoverMaterial);
  const selected = new LineSegments(empty, selectedMaterial);
  const roleLines: Record<HighlightRole, LineSegments> = {
    related: new LineSegments(empty, roleMaterials.related),
    contrast: new LineSegments(empty, roleMaterials.contrast),
  };
  roleLines.related.scale.setScalar(1.0002);
  roleLines.contrast.scale.setScalar(1.0002);
  hover.scale.setScalar(1.0004);
  selected.scale.setScalar(1.0006);
  group.add(base, roleLines.related, roleLines.contrast, hover, selected);

  const cache = new Map<string, BufferGeometry>();
  let roles: HighlightRoles = { related: [], contrast: [] };
  const a = new Vector3();
  const b = new Vector3();
  const point = new Vector3();
  const toPoint = ([lng, lat]: number[], out: Vector3) => {
    const phi = (lat * Math.PI) / 180;
    const theta = (lng * Math.PI) / 180;
    return out.set(Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta));
  };
  const geometry = (positions: ArrayLike<number>) => {
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(positions, 3));
    result.computeBoundingSphere();
    return result;
  };
  const concat = (ids: readonly string[]) => {
    const parts = ids.flatMap((id) => cache.get(id)?.getAttribute('position').array ?? []);
    const result = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  };
  // Base and role geometries are owned here; per-country geometries live in the cache.
  const release = (lines: LineSegments) => {
    if (lines.geometry !== empty) lines.geometry.dispose();
    lines.geometry = empty;
  };
  const rebuildRoles = () => {
    for (const role of ['related', 'contrast'] as const) {
      release(roleLines[role]);
      const positions = concat(roles[role]);
      if (positions.length) roleLines[role].geometry = geometry(positions);
    }
  };
  const clear = () => {
    hover.geometry = selected.geometry = empty;
    for (const item of cache.values()) item.dispose();
    cache.clear();
    release(base);
  };

  return {
    group,
    setFeatures(features: CountryFeature[]) {
      clear();
      for (const feature of features) {
        const positions: number[] = [];
        const polygons =
          feature.geometry.type === 'Polygon'
            ? [feature.geometry.coordinates]
            : feature.geometry.coordinates;
        for (const polygon of polygons) {
          for (const ring of polygon) {
            for (let i = 1; i < ring.length; i++) {
              toPoint(ring[i - 1], a);
              toPoint(ring[i], b);
              const steps = Math.max(1, Math.ceil(a.angleTo(b) / ((0.75 * Math.PI) / 180)));
              for (let j = 0; j < steps; j++) {
                for (const t of [j / steps, (j + 1) / steps]) {
                  point.copy(a).lerp(b, t).normalize().multiplyScalar(radius);
                  positions.push(point.x, point.y, point.z);
                }
              }
            }
          }
        }
        cache.set(feature.properties.ADM0_A3, geometry(positions));
      }
      base.geometry = geometry(concat([...cache.keys()]));
      rebuildRoles();
    },
    setRoles(next: HighlightRoles) {
      roles = { related: [...next.related], contrast: [...next.contrast] };
      rebuildRoles();
    },
    highlight(selectedId?: string, hoveredId?: string) {
      selected.geometry = cache.get(selectedId ?? '') ?? empty;
      hover.geometry = hoveredId === selectedId ? empty : (cache.get(hoveredId ?? '') ?? empty);
    },
    dispose() {
      release(roleLines.related);
      release(roleLines.contrast);
      clear();
      empty.dispose();
      for (const item of [
        baseMaterial,
        hoverMaterial,
        selectedMaterial,
        ...Object.values(roleMaterials),
      ]) {
        item.dispose();
      }
      group.removeFromParent();
    },
  };
}
