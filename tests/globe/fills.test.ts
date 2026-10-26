import { readFileSync } from 'node:fs';
import type { Mesh } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CountryFeature } from '../../src/globe/cartography';

type Fills = typeof import('../../src/globe/fills');
let createCountryFills: Fills['createCountryFills'];

beforeAll(async () => {
  // The cap geometry library reads window.THREE at module initialization, even with imported Three.js.
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  ({ createCountryFills } = await import('../../src/globe/fills'));
  Reflect.deleteProperty(globalThis, 'window');
});

const features = JSON.parse(
  readFileSync(new URL('../../public/maps/countries-detail.geojson', import.meta.url), 'utf8'),
).features as CountryFeature[];

describe('country fills', () => {
  it('uses at most two fill meshes for island-rich countries and keeps spherical geometry', () => {
    const fills = createCountryFills(100.15);
    fills.setFeatures(features);
    fills.highlight('KAZ', 'RUS');
    const meshes = fills.group.children as Mesh[];
    expect(meshes.filter((mesh) => mesh.visible)).toHaveLength(2);
    for (const mesh of meshes.filter((item) => item.visible)) {
      expect(mesh.geometry.groups, 'islands are merged into one material draw').toHaveLength(0);
      const positions = mesh.geometry.getAttribute('position');
      expect(positions.count).toBeGreaterThan(100);
      for (let index = 0; index < positions.count; index++) {
        const radius = Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index));
        expect(Math.abs(radius - 100.15)).toBeLessThan(0.001);
      }
    }
    fills.highlight('SGP', 'SGP');
    const visible = meshes.filter((mesh) => mesh.visible);
    expect(visible, 'hover does not double-fill the selected country').toHaveLength(1);
    expect(visible[0].geometry.getAttribute('position').count, 'tiny islands remain fillable')
      .toBeGreaterThan(0);
    fills.highlight();
    expect(meshes.filter((mesh) => mesh.visible)).toHaveLength(0);
    fills.dispose();
  });

  it('disposes cached caps on geometry refinement and rebuilds the selected country', () => {
    const fills = createCountryFills(100.15);
    fills.setFeatures(features);
    fills.highlight('FRA');
    const selected = fills.group.children.find((child) => child.visible) as Mesh;
    const old = selected.geometry;
    let disposed = false;
    old.addEventListener('dispose', () => {
      disposed = true;
    });
    fills.setFeatures(features);
    expect(disposed).toBe(true);
    fills.highlight('FRA');
    expect(selected.geometry).not.toBe(old);
    expect(selected.visible).toBe(true);
    fills.dispose();
  });
});
