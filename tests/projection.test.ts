import assert from 'node:assert/strict';
import { test } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createGlobeUnprojector } from '../app/globe/projection';

function cameraAt(lat: number, lng: number, altitude: number) {
  const camera = new PerspectiveCamera(50, 1.5, .1, 2000);
  const r = 100 * (1 + altitude);
  camera.position.set(r * Math.cos(lat) * Math.sin(lng), r * Math.sin(lat), r * Math.cos(lat) * Math.cos(lng));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

test('surface lookup round-trips country coordinates as the globe rotates and zooms', () => {
  for (const altitude of [.16, .8, 1.95, 4.5]) {
    for (const [lat, lng] of [[23, 83], [46, 2], [-9, 126], [40, -100], [0, 179], [75, -40]]) {
      const camera = cameraAt(lat * Math.PI / 180, lng * Math.PI / 180, altitude);
      const unproject = createGlobeUnprojector(camera, 100);
      const position = camera.position.clone().normalize().multiplyScalar(100).project(camera);
      const point = unproject((position.x + 1) * 450, (1 - position.y) * 300, 900, 600)!;
      assert.ok(point);
      assert.ok(Math.abs(point.lat - lat) < 1e-6);
      assert.ok(Math.abs(point.lng - lng) < 1e-6);
      const neighbor = new Vector3(8, 4, 99.6).normalize().multiplyScalar(100).applyQuaternion(camera.quaternion).project(camera);
      assert.ok(unproject((neighbor.x + 1) * 450, (1 - neighbor.y) * 300, 900, 600));
    }
  }
});

test('surface lookup rejects points beyond the globe and invalid viewport sizes', () => {
  const unproject = createGlobeUnprojector(cameraAt(0, 0, 1.95), 100);
  assert.equal(unproject(0, 0, 900, 600), null);
  assert.equal(unproject(450, 300, 0, 600), null);
  assert.deepEqual(unproject(450, 300, 900, 600), { lat: 0, lng: 0 });
});
