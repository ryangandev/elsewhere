import { AmbientLight, DirectionalLight, MeshPhongMaterial, DataTexture, RGBAFormat, RepeatWrapping, NoColorSpace, Vector3, type Texture, type Camera } from 'three';
export { TextureLoader, SRGBColorSpace } from 'three';
export type BasemapMode = 'texture' | 'vector';

export function createAtlasMaterials() {
  const neutral = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
  neutral.needsUpdate = true;
  const relief = { value: neutral as Texture };
  const step = { value: 1 / 4096 };
  function land(color: string) {
    const material = new MeshPhongMaterial({ color, shininess: 0, specular: '#000000' });
    material.onBeforeCompile = shader => {
      shader.uniforms.atlasRelief = relief;
      shader.uniforms.atlasStep = step;
      shader.vertexShader = 'varying vec3 atlasPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\natlasPosition = position;');
      shader.fragmentShader = 'varying vec3 atlasPosition;\nuniform sampler2D atlasRelief;\nuniform float atlasStep;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec3 sphere = normalize(atlasPosition);
        vec2 earthUV = vec2(atan(sphere.x, sphere.z) / 6.28318530718 + 0.5, asin(clamp(sphere.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
        float height = texture2D(atlasRelief, earthUV).r;
        float west = texture2D(atlasRelief, earthUV - vec2(atlasStep, 0.0)).r;
        float east = texture2D(atlasRelief, earthUV + vec2(atlasStep, 0.0)).r;
        float south = texture2D(atlasRelief, earthUV - vec2(0.0, atlasStep * 2.0)).r;
        float north = texture2D(atlasRelief, earthUV + vec2(0.0, atlasStep * 2.0)).r;
        float shade = clamp(1.0 + (west - east) * 12.0 + (south - north) * 8.0, 0.76, 1.13);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.83, 0.81, 0.73), height * 0.6) * shade;
      `);
    };
    material.customProgramCacheKey = () => 'elsewhere-elevation-v1';
    return material;
  }
  const base = land('#bbc6b5');
  const hover = land('#d7debe');
  const selected = land('#d4dcad');
  const ocean = new MeshPhongMaterial({ color: '#163b4b', shininess: 5, specular: '#1c3440' });
  const photo = new MeshPhongMaterial({ color: '#ffffff', shininess: 2, specular: '#101a20' });
  const ambient = new AmbientLight('#f1f4ef', .95);
  const key = new DirectionalLight('#fff6df', 1.1);
  const fill = new DirectionalLight('#b5d9ee', .35);
  const offset = new Vector3();
  function followCamera(camera: Camera) {
    key.position.copy(camera.position).add(offset.set(-100, 160, 50).applyQuaternion(camera.quaternion));
    fill.position.copy(camera.position).add(offset.set(160, -30, 80).applyQuaternion(camera.quaternion));
  }
  return { base, hover, selected, ocean, photo, lights: [ambient, key, fill], followCamera,
    setRelief(texture: Texture, width: number) {
      texture.colorSpace = NoColorSpace;
      texture.wrapS = RepeatWrapping;
      texture.needsUpdate = true;
      if (relief.value !== neutral) relief.value.dispose();
      relief.value = texture;
      step.value = 1 / width;
    },
    dispose() { for (const material of [base, hover, selected, ocean, photo]) material.dispose(); photo.map?.dispose(); relief.value.dispose(); if (relief.value !== neutral) neutral.dispose(); }
  };
}
