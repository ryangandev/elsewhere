import { Raycaster, Sphere, Vector2, Vector3, type Camera } from 'three';

// Coordinate lookup only needs the globe's mathematical surface. Globe.GL's
// toGlobeCoords also raycasts every country, island and border in the scene.
export function createGlobeUnprojector(camera: Camera, radius: number) {
  const raycaster = new Raycaster();
  const surface = new Sphere(new Vector3(), radius);
  const pointer = new Vector2();
  const hit = new Vector3();
  return (x: number, y: number, width: number, height: number) => {
    if (width <= 0 || height <= 0) return null;
    pointer.set((x / width) * 2 - 1, 1 - (y / height) * 2);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectSphere(surface, hit)) return null;
    return {
      lat: (Math.atan2(hit.y, Math.hypot(hit.x, hit.z)) * 180) / Math.PI,
      lng: (Math.atan2(hit.x, hit.z) * 180) / Math.PI,
    };
  };
}
