import {
  AmbientLight,
  DirectionalLight,
  MeshPhongMaterial,
  SRGBColorSpace,
  Vector3,
  type Camera,
  type Texture,
} from 'three';

// The globe surface is the 4K Earth image under soft camera-relative lighting.
// Measured against vector land meshes, the image basemap held frame rate while zoomed in.
export function createBasemapMaterial() {
  const material = new MeshPhongMaterial({ color: '#ffffff', shininess: 2, specular: '#101a20' });
  const ambient = new AmbientLight('#f1f4ef', 0.95);
  const key = new DirectionalLight('#fff6df', 1.1);
  const fill = new DirectionalLight('#b5d9ee', 0.35);
  const offset = new Vector3();
  return {
    material,
    lights: [ambient, key, fill],
    setImage(texture: Texture, maxAnisotropy: number) {
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = Math.min(8, maxAnisotropy);
      texture.needsUpdate = true;
      material.map?.dispose();
      material.map = texture;
      material.needsUpdate = true;
    },
    // Lights stay fixed relative to the viewer, so the visible hemisphere is always lit.
    followCamera(camera: Camera) {
      key.position
        .copy(camera.position)
        .add(offset.set(-100, 160, 50).applyQuaternion(camera.quaternion));
      fill.position
        .copy(camera.position)
        .add(offset.set(160, -30, 80).applyQuaternion(camera.quaternion));
    },
    dispose() {
      material.map?.dispose();
      material.dispose();
    },
  };
}
