import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import type { CountryFeature } from './cartography';

// One draw for all borders, plus one each for the hovered and selected country.
// Keeping islands in these buffers avoids thousands of separate Three.js objects.
export function createCountryBorders(radius: number) {
  const group = new Group();
  const baseMaterial = new LineBasicMaterial({ color: '#d9e6dd', transparent: true, opacity: .22, depthWrite: false });
  const hoverMaterial = new LineBasicMaterial({ color: '#f5f6d9', transparent: true, opacity: .9, depthWrite: false });
  const selectedMaterial = new LineBasicMaterial({ color: '#e5dda8', transparent: true, opacity: 1, depthWrite: false });
  const empty = new BufferGeometry();
  const base = new LineSegments(empty, baseMaterial);
  const hover = new LineSegments(empty, hoverMaterial);
  const selected = new LineSegments(empty, selectedMaterial);
  hover.scale.setScalar(1.0004);
  selected.scale.setScalar(1.0006);
  group.add(base, hover, selected);
  const cache = new Map<string, BufferGeometry>();
  const a = new Vector3(), b = new Vector3(), point = new Vector3();
  const toPoint = ([lng, lat]: number[], out: Vector3) => {
    const phi = lat * Math.PI / 180, theta = lng * Math.PI / 180;
    return out.set(Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta));
  };
  const geometry = (positions: number[]) => {
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(positions, 3));
    result.computeBoundingSphere();
    return result;
  };
  const clear = () => { for (const item of cache.values()) item.dispose(); cache.clear(); if (base.geometry !== empty) base.geometry.dispose(); };
  return {
    group,
    setFeatures(features: CountryFeature[]) {
      clear();
      const all: number[] = [];
      for (const feature of features) {
        const positions: number[] = [];
        const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
        for (const polygon of polygons) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
          toPoint(ring[i - 1], a); toPoint(ring[i], b);
          const steps = Math.max(1, Math.ceil(a.angleTo(b) / (.75 * Math.PI / 180)));
          for (let j = 0; j < steps; j++) {
            for (const t of [j / steps, (j + 1) / steps]) {
              point.copy(a).lerp(b, t).normalize().multiplyScalar(radius);
              positions.push(point.x, point.y, point.z);
            }
          }
        }
        cache.set(feature.properties.ADM0_A3, geometry(positions));
        for (const value of positions) all.push(value);
      }
      base.geometry = geometry(all);
      hover.geometry = selected.geometry = empty;
    },
    highlight(selectedId?: string, hoveredId?: string) {
      selected.geometry = cache.get(selectedId ?? '') ?? empty;
      hover.geometry = hoveredId === selectedId ? empty : cache.get(hoveredId ?? '') ?? empty;
    },
    dispose() { clear(); empty.dispose(); baseMaterial.dispose(); hoverMaterial.dispose(); selectedMaterial.dispose(); group.removeFromParent(); },
  };
}
