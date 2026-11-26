import * as THREE from 'three';

/**
 * Box-projected (parallax-corrected) environment lighting.
 *
 * A probe is a 360 picture taken from one point, and three.js treats it as
 * infinitely far away: on a table top the window and chandelier then show
 * magnified and in the wrong place. Box projection instead treats the probe
 * as painted on the room's walls (a box): each reflection ray is traced to
 * the box, and the probe is read in the direction from where it was taken
 * to that hit point. Reflections then sit where the room really is.
 *
 * Unlike drei's useBoxProjectedEnv, this keeps a material's own shader
 * patches (it chains onto an existing onBeforeCompile), and the probe's
 * position may differ from the box centre (ours is taken just above the
 * table, not at mid-room height).
 */
export type BoxProjection = {
  /** Centre and size of the room box, world metres. */
  boxCentre: THREE.Vector3;
  boxSize: THREE.Vector3;
  /** Where the probe was rendered from. */
  probePosition: THREE.Vector3;
};

/**
 * Shared by every box-projected material: 1 on, 0 off (the plain infinite
 * probe), for A/B comparison without recompiling.
 */
export const boxProjectionUniforms = {
  uBoxMax: { value: new THREE.Vector3() },
  uBoxMin: { value: new THREE.Vector3() },
  uBoxOn: { value: 1 },
  uProbePos: { value: new THREE.Vector3() },
};

/** Set the room box and probe position (all box-projected materials). */
export const setBoxProjection = (box: BoxProjection) => {
  const half = box.boxSize.clone().multiplyScalar(0.5);
  boxProjectionUniforms.uBoxMin.value.copy(box.boxCentre).sub(half);
  boxProjectionUniforms.uBoxMax.value.copy(box.boxCentre).add(half);
  boxProjectionUniforms.uProbePos.value.copy(box.probePosition);
};

export const setBoxProjectionOn = (on: boolean) => {
  boxProjectionUniforms.uBoxOn.value = on ? 1 : 0;
};

const DEFINITIONS = /* glsl */ `
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uProbePos;
uniform float uBoxOn;
varying vec3 vBoxWorldPos;
vec3 boxProject( vec3 dir ) {
  vec3 d = normalize( dir );
  vec3 tMax = ( uBoxMax - vBoxWorldPos ) / d;
  vec3 tMin = ( uBoxMin - vBoxWorldPos ) / d;
  vec3 t = max( tMax, tMin );
  float hit = min( min( t.x, t.y ), t.z );
  vec3 projected = normalize( vBoxWorldPos + d * hit - uProbePos );
  return normalize( mix( d, projected, uBoxOn ) );
}
`;

const RADIANCE_ANCHOR = 'reflectVec = inverseTransformDirection( reflectVec, viewMatrix );';
const IRRADIANCE_ANCHOR = 'vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );';

const patch = (shader: THREE.WebGLProgramParametersWithUniforms) => {
  Object.assign(shader.uniforms, boxProjectionUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vBoxWorldPos;')
    .replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nvBoxWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
    );
  // Inline the env chunk (unless an earlier patch already did), then hook
  // its two world-space lookups.
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment)
    .replace(RADIANCE_ANCHOR, `${RADIANCE_ANCHOR}\n reflectVec = boxProject( reflectVec );`)
    .replace(IRRADIANCE_ANCHOR, `${IRRADIANCE_ANCHOR}\n worldNormal = boxProject( worldNormal );`)
    .replace('#include <common>', `#include <common>\n${DEFINITIONS}`);
};

/** Add box projection to a material, keeping any shader patch it has. */
export const addBoxProjection = (material: THREE.Material) => {
  if (material.userData.boxProjected) return;
  material.userData.boxProjected = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    patch(shader);
  };
  material.customProgramCacheKey = () => `${previousKey()}|boxenv`;
  material.needsUpdate = true;
};
