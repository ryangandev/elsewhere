import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Mesh } from 'three';
// The geometry library checks window.THREE at module initialization even when using imported Three.js.
Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
const { createCountryFills } = await import('../app/globe/fills');
Reflect.deleteProperty(globalThis, 'window');
import type { CountryFeature } from '../app/globe/cartography';
const features = JSON.parse(readFileSync(new URL('../public/maps/countries-detail.geojson', import.meta.url), 'utf8')).features as CountryFeature[];

test('island-rich countries use at most two fill meshes and retain spherical geometry', () => {
  const fills = createCountryFills(100.15);
  fills.setFeatures(features);
  fills.highlight('KAZ', 'RUS');
  const meshes = fills.group.children as Mesh[];
  assert.equal(meshes.filter(mesh => mesh.visible).length, 2);
  for (const mesh of meshes) {
    assert.equal(mesh.geometry.groups.length, 0, 'islands are merged into one material draw');
    const positions = mesh.geometry.getAttribute('position');
    assert.ok(positions.count > 100);
    for (let index = 0; index < positions.count; index++) {
      const radius = Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index));
      assert.ok(Math.abs(radius - 100.15) < .001);
    }
  }
  fills.highlight('SGP', 'SGP');
  assert.equal(meshes.filter(mesh => mesh.visible).length, 1, 'hover does not double-fill the selected country');
  assert.ok(meshes.find(mesh => mesh.visible)!.geometry.getAttribute('position').count > 0, 'tiny islands remain fillable');
  fills.highlight();
  assert.equal(meshes.filter(mesh => mesh.visible).length, 0);
  fills.dispose();
});

test('geometry refinement disposes cached caps and rebuilds the selected country', () => {
  const fills = createCountryFills(100.15);
  fills.setFeatures(features);
  fills.highlight('FRA');
  const selected = fills.group.children.find(child => child.visible) as Mesh;
  const old = selected.geometry;
  let disposed = false;
  old.addEventListener('dispose', () => { disposed = true; });
  fills.setFeatures(features);
  assert.ok(disposed);
  fills.highlight('FRA');
  assert.notEqual(selected.geometry, old);
  assert.ok(selected.visible);
  fills.dispose();
});
