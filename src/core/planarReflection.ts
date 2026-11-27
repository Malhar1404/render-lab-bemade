import * as THREE from 'three';

/**
 * The room mirrored in the table top.
 *
 * The probe (a 360 photo from one point) can't show what really stands
 * round the table: the chairs, the chandelier above, the room at the right
 * place. Each frame the scene is rendered once more from the camera
 * mirrored in the top's plane, into a texture with mip levels. The top's
 * shader (topShade.ts) uses it in place of the probe's reflection on its
 * flat upper face, blurred by its roughness: sharp when polished, soft on
 * silk, a faint haze on matte (the Fresnel term keeps that one weak).
 */

export const planarUniforms = {
  tPlanar: { value: null as THREE.Texture | null },
  uPlanarMatrix: { value: new THREE.Matrix4() },
  uPlanarOn: { value: 0 },
  uPlanarStrength: { value: 1 },
};

/** Reflection strength (1: physically right). 0 turns the pass off. */
export const setPlanarStrength = (s: number) => {
  planarUniforms.uPlanarStrength.value = s;
};

/** Half the screen's resolution: the reflection is blurred anyway. */
const SCALE = 0.5;
const target = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  generateMipmaps: true,
  minFilter: THREE.LinearMipmapLinearFilter,
  magFilter: THREE.LinearFilter,
  samples: 0,
});
const mirror = new THREE.PerspectiveCamera();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const size = new THREE.Vector2();
const lookAt = new THREE.Vector3();
const forward = new THREE.Vector3();
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

/**
 * Renders the mirror image for a top whose upper face is at `topY`.
 * `hide`: what must not show in its own reflection (the table).
 */
export const renderTopReflection = (
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  topY: number,
  hide: THREE.Object3D[],
) => {
  const cam = camera as THREE.PerspectiveCamera;
  // Off when not wanted, or when looking from below the top.
  if (planarUniforms.uPlanarStrength.value <= 0 || !cam.isPerspectiveCamera || cam.position.y <= topY) {
    planarUniforms.uPlanarOn.value = 0;
    return;
  }
  gl.getDrawingBufferSize(size).multiplyScalar(SCALE).floor();
  if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);

  // The camera mirrored in the plane y = topY.
  mirror.copy(cam);
  mirror.position.set(cam.position.x, 2 * topY - cam.position.y, cam.position.z);
  cam.getWorldDirection(forward);
  lookAt.copy(cam.position).add(forward);
  lookAt.y = 2 * topY - lookAt.y;
  mirror.up.set(cam.up.x, -cam.up.y, cam.up.z);
  mirror.lookAt(lookAt);
  mirror.updateMatrixWorld();
  mirror.projectionMatrix.copy(cam.projectionMatrix);

  // How a world point finds its place in the mirror image.
  planarUniforms.uPlanarMatrix.value
    .copy(BIAS)
    .multiply(mirror.projectionMatrix)
    .multiply(mirror.matrixWorldInverse);

  // Draw only what is above the top, without the table, and reuse this
  // frame's shadow maps.
  plane.constant = -topY;
  const was = hide.map((o) => o.visible);
  hide.forEach((o) => (o.visible = false));
  const clipping = gl.clippingPlanes;
  const shadows = gl.shadowMap.autoUpdate;
  const prevTarget = gl.getRenderTarget();
  gl.clippingPlanes = [plane];
  gl.shadowMap.autoUpdate = false;
  planarUniforms.uPlanarOn.value = 0;
  gl.setRenderTarget(target);
  gl.clear();
  gl.render(scene, mirror);
  gl.setRenderTarget(prevTarget);
  gl.shadowMap.autoUpdate = shadows;
  gl.clippingPlanes = clipping;
  hide.forEach((o, i) => (o.visible = was[i]));

  planarUniforms.tPlanar.value = target.texture;
  planarUniforms.uPlanarOn.value = 1;
};

export const PLANAR_DECLARATIONS = /* glsl */ `
uniform sampler2D tPlanar;
uniform mat4 uPlanarMatrix;
uniform float uPlanarOn;
uniform float uPlanarStrength;

// The mirror image at this point, blurred by roughness (mip level), and
// rippled a little by the surface's normal map.
vec3 planarReflection(vec3 worldPos, vec3 worldNormal, float roughness) {
  vec4 c = uPlanarMatrix * vec4(worldPos, 1.0);
  vec2 uv = c.xy / c.w + worldNormal.xz * 0.02;
  float lod = 0.5 * log2(1.0 + roughness * roughness * 4000.0);
  return textureLod(tPlanar, uv, lod).rgb * uPlanarStrength;
}
`;

export const PLANAR_PATCH = /* glsl */ `
#include <lights_fragment_maps>
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
if (uPlanarOn > 0.5) {
  vec3 planarN = inverseTransformDirection(normal, viewMatrix);
  // Only the flat upper face mirrors the room, not the edges.
  float planarFacing = smoothstep(0.9, 0.98, inverseTransformDirection(geometryNormal, viewMatrix).y);
  if (planarFacing > 0.0) {
    radiance = mix(radiance, planarReflection(vTopShadeWorldPosition, planarN, material.roughness), planarFacing);
    #ifdef USE_CLEARCOAT
      vec3 planarCoatN = inverseTransformDirection(clearcoatNormal, viewMatrix);
      clearcoatRadiance = mix(
        clearcoatRadiance,
        planarReflection(vTopShadeWorldPosition, planarCoatN, material.clearcoatRoughness),
        planarFacing
      );
    #endif
  }
}
#endif
`;
