import * as THREE from 'three';

import {
  CHANDELIER_APPLY,
  CHANDELIER_DECLARATIONS,
  chandelierUniforms,
} from './chandelierLight';
import { PLANAR_DECLARATIONS, PLANAR_PATCH, planarUniforms } from './planarReflection';

/**
 * Shade under the table top, for the base.
 *
 * Most of the base's light comes from the HDR environment, and three.js
 * applies environment light without any occlusion: a pedestal right under
 * the top was lit as if the top weren't there. This shader works out, for
 * each point of the base, how much of the sky the top hides, and dims the
 * environment light (diffuse and reflections) by that much.
 *
 * A point at depth d below the top's underside, e metres in from the
 * nearest edge of the top, sees the sky only through the gap between the
 * top and the horizon, up to an elevation of atan(d / e). The light through
 * that gap is about sin(atan(d / e)) = d / sqrt(d^2 + e^2) of the full sky:
 * 0 just under the top, rising to 1 well below it or outside the top.
 *
 * The key light's shadow is separate: the base receives its shadow map.
 */

/**
 * Light left in the darkest spot, right under the top: the top's underside
 * is not black, it reflects light from the floor. 0 is black, 1 no shade.
 */
const TOP_SHADE_MIN_LIGHT = 0.04;
/**
 * Rounding of the top's corners, as a share of its half width: 1 is a full
 * round end (round and oval tops), 0 square corners. The shade is soft,
 * so 0.5 is close enough for every top shape.
 */
const TOP_CORNER_ROUNDING = 0.5;
/** Shared by every base material, and updated as the top moves or resizes. */
const topShadeUniforms = {
  uTopCenter: { value: new THREE.Vector2() },
  uTopCornerRadius: { value: 0 },
  uTopHalfSize: { value: new THREE.Vector2() },
  uTopShadeMinLight: { value: TOP_SHADE_MIN_LIGHT },
  // Far below everything: no top, no shade.
  uTopUnderY: { value: -1e4 },
};

/**
 * Highlight roll-off for the diffuse light of table and chair materials
 * (the room only): a white top lit by the studio HDR, key light and
 * chandelier got about twice the light a white can show, and clipped flat.
 * Diffuse light above `knee` is compressed and rises at most `roll` more;
 * dark finishes stay below the knee, and gloss is left alone. Knee 0: off.
 */
const diffuseRolloffUniforms = {
  uDiffuseKnee: { value: 0 },
  uDiffuseRoll: { value: 0.25 },
};

export const setDiffuseRolloff = (knee: number, roll = 0.25) => {
  diffuseRolloffUniforms.uDiffuseKnee.value = knee;
  diffuseRolloffUniforms.uDiffuseRoll.value = roll;
};

const DIFFUSE_ROLLOFF_DECLARATIONS = /* glsl */ `
uniform float uDiffuseKnee;
uniform float uDiffuseRoll;
`;

/**
 * The table top's own look in the room. A white top got more light than a
 * white can show, and squashing the highlights (the roll-off above) flattened
 * its light-grey veining with it. Instead the top's diffuse light is scaled
 * down evenly (`scale`, 1: unchanged), which keeps the pattern's contrast, and
 * the stone's colour gets a levels curve (`veinDepth`, 0: off): pure white
 * stays white, the lighter half of the tones is pulled down a little, so
 * veins and wisps read crisply. Dark tones (below the lighter half) are left
 * alone, so dark finishes don't go muddy.
 */
const topFinishUniforms = {
  uTopDiffuseScale: { value: 1 },
  uTopVeinDepth: { value: 0 },
};

export const setTopFinish = (scale: number, veinDepth: number) => {
  topFinishUniforms.uTopDiffuseScale.value = scale;
  topFinishUniforms.uTopVeinDepth.value = veinDepth;
};

const TOP_FINISH_DECLARATIONS = /* glsl */ `
uniform float uTopDiffuseScale;
uniform float uTopVeinDepth;
`;

/** Tones below this (perceptual, 0 to 1) are left alone. */
const VEIN_CURVE_START = '0.45';

const TOP_VEIN_CURVE = /* glsl */ `
#include <map_fragment>
if (uTopVeinDepth > 0.0) {
  float veinLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  // Work in perceptual (roughly sRGB) tones, where "lighter half" means
  // what it looks like.
  float veinTone = pow(max(veinLum, 1e-5), 1.0 / 2.2);
  float veinT = clamp((veinTone - ${VEIN_CURVE_START}) / (1.0 - ${VEIN_CURVE_START}), 0.0, 1.0);
  float veinCurved = ${VEIN_CURVE_START} + (1.0 - ${VEIN_CURVE_START}) * pow(veinT, 1.0 + uTopVeinDepth);
  float veinNewTone = veinTone > ${VEIN_CURVE_START} ? veinCurved : veinTone;
  diffuseColor.rgb *= pow(veinNewTone / veinTone, 2.2);
}
`;

/**
 * The table decor's mirror image (TableDecor.tsx renders it each frame into
 * a screen-sized texture, before the scene). The top uses it in place of
 * the environment's reflection wherever a piece stands in the way: a real
 * vase blocks the studio's bright reflection on the stone, so it shows as
 * its own (often darker) reflection. The stone's own Fresnel, finish and
 * roughness then set how strong and how blurred it is, as for the rest of
 * its reflection. Off (`uDecorReflectionOn` 0) without decor.
 */
export const decorReflectionUniforms = {
  tDecorReflection: { value: null as THREE.Texture | null },
  uDecorReflectionOn: { value: 0 },
  uDecorResolution: { value: new THREE.Vector2(1, 1) },
};

const DECOR_REFLECTION_DECLARATIONS = /* glsl */ `
uniform sampler2D tDecorReflection;
uniform float uDecorReflectionOn;
uniform vec2 uDecorResolution;

const vec2 DECOR_TAPS[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457),
  vec2(-0.203, 0.621), vec2(0.962, -0.195), vec2(0.473, -0.480),
  vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064),
  vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

// The mirror image here, blurred by the surface's roughness: alpha is how
// much of the reflection the pieces cover, rgb their (premultiplied) light.
vec4 decorReflection(float roughness) {
  vec2 uv = gl_FragCoord.xy / uDecorResolution;
  vec2 radius = (1.5 + roughness * 40.0) / uDecorResolution;
  vec4 sum = texture2D(tDecorReflection, uv);
  for (int i = 0; i < 12; i++) {
    sum += texture2D(tDecorReflection, uv + DECOR_TAPS[i] * radius);
  }
  return sum / 13.0;
}
`;

const DECOR_REFLECTION_PATCH = /* glsl */ `
#include <lights_fragment_maps>
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
if (uDecorReflectionOn > 0.5) {
  // Only the flat upper face is a mirror for the pieces, not its edges.
  float decorFacing = smoothstep(
    0.9, 0.98, inverseTransformDirection(geometryNormal, viewMatrix).y
  );
  if (decorFacing > 0.0) {
    vec4 decorBase = decorReflection(material.roughness);
    radiance = mix(
      radiance,
      decorBase.rgb / max(decorBase.a, 1e-4),
      decorBase.a * decorFacing
    );
    #ifdef USE_CLEARCOAT
      vec4 decorCoat = decorReflection(material.clearcoatRoughness);
      clearcoatRadiance = mix(
        clearcoatRadiance,
        decorCoat.rgb / max(decorCoat.a, 1e-4),
        decorCoat.a * decorFacing
      );
    #endif
  }
}
#endif
`;

const TOP_DIFFUSE_SCALE = /* glsl */ `
totalDiffuse *= uTopDiffuseScale;
`;

const DIFFUSE_ROLLOFF = /* glsl */ `
if (uDiffuseKnee > 0.0) {
  vec3 diffuseOver = max(totalDiffuse - uDiffuseKnee, 0.0);
  totalDiffuse = min(totalDiffuse, vec3(uDiffuseKnee))
    + diffuseOver / (1.0 + diffuseOver / uDiffuseRoll);
}
`;

const topBox = new THREE.Box3();

/**
 * The top's bounds as last measured (updateTopShade, every frame): its
 * surface is max.y. Empty until a top is in. Read only.
 */
export const getTopBounds = (): Readonly<THREE.Box3> => topBox;

/**
 * Sets the top's footprint and underside from its meshes (top and MDF
 * board), in world space. Cheap: it uses each mesh's bounding box.
 */
export const updateTopShade = (top: THREE.Object3D) => {
  topBox.setFromObject(top);
  if (topBox.isEmpty()) {
    topShadeUniforms.uTopUnderY.value = -1e4;
    return;
  }
  const halfX = (topBox.max.x - topBox.min.x) / 2;
  const halfZ = (topBox.max.z - topBox.min.z) / 2;
  topShadeUniforms.uTopCenter.value.set(
    (topBox.min.x + topBox.max.x) / 2,
    (topBox.min.z + topBox.max.z) / 2,
  );
  topShadeUniforms.uTopHalfSize.value.set(halfX, halfZ);
  topShadeUniforms.uTopCornerRadius.value =
    Math.min(halfX, halfZ) * TOP_CORNER_ROUNDING;
  topShadeUniforms.uTopUnderY.value = topBox.min.y;
};

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vTopShadeWorldPosition;
`;

const VERTEX_WORLD_POSITION = /* glsl */ `
#include <project_vertex>
vTopShadeWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
varying vec3 vTopShadeWorldPosition;
uniform vec2 uTopCenter;
uniform vec2 uTopHalfSize;
uniform float uTopCornerRadius;
uniform float uTopUnderY;
uniform float uTopShadeMinLight;

// Signed distance to the edge of the top's footprint (a rounded rectangle),
// seen from above: negative inside the top.
float topFootprintDistance(vec2 p) {
  vec2 q = abs(p - uTopCenter) - (uTopHalfSize - uTopCornerRadius);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uTopCornerRadius;
}

// Share of the environment light that reaches this point past the top.
float topShadeLight(vec3 worldPosition, vec3 worldNormal) {
  float depth = max(uTopUnderY - worldPosition.y, 0.0);
  float inset = max(-topFootprintDistance(worldPosition.xz), 0.0);
  float skyVisible = depth / max(sqrt(depth * depth + inset * inset), 1e-4);
  // Faces pointing up see mostly the top's underside, so are shaded more;
  // faces pointing down see the floor, which the top doesn't hide.
  skyVisible = mix(skyVisible, skyVisible * skyVisible, max(worldNormal.y, 0.0));
  skyVisible = mix(skyVisible, 1.0, max(-worldNormal.y, 0.0));
  return mix(uTopShadeMinLight, 1.0, skyVisible);
}

`;

/**
 * No darkening of the base where it meets the floor: it read as dark paint
 * on the base's foot. The floor's contact shadows (Shadow.tsx) ground it.
 *
 * The HDR environment is added in `lights_fragment_maps`; attenuate it
 * there, before it becomes reflected light. This leaves direct lights and
 * the rest of the room alone, while preventing the HDR from filling in the
 * physical cavities beneath the top.
 */
const ENVIRONMENT_CONTACT_PATCH = /* glsl */ `
#include <lights_fragment_maps>
float furnitureContactShade = topShadeLight(
  vTopShadeWorldPosition,
  normalize(inverseTransformDirection(normal, viewMatrix))
);

#if defined( RE_IndirectDiffuse ) && defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
  iblIrradiance *= furnitureContactShade;
#endif

#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
  radiance *= furnitureContactShade;
  #ifdef USE_CLEARCOAT
    clearcoatRadiance *= furnitureContactShade;
  #endif
#endif
`;

const OUTGOING_LIGHT =
  'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;';

/**
 * The tabletop also blocks the intentional key light. HDR-only occlusion is
 * insufficient for metallic bases because direct/specular lighting can still
 * make the covered underside look bright. Keep a small amount of bounced
 * light, but apply the footprint visibility to the completed base lighting.
 */
const applyTopCoverageToBaseLight = (shader: string) =>
  shader.replace(
    OUTGOING_LIGHT,
    `${OUTGOING_LIGHT}
// 0.8 preserves a little bounced light from the floor; the rest is blocked
// by the tabletop above this part of the base.
outgoingLight *= mix(1.0, furnitureContactShade, 0.8);`,
  );

/**
 * Adds object-local contact shading to table/chair materials. This is not a
 * scene-wide AO pass: only base materials are patched with the tabletop's
 * coverage shadow. Chairs and floor contact receive no AO treatment.
 */
export const applyTableShading = (
  material: THREE.MeshStandardMaterial,
  { underTop, isTop = false }: { underTop: boolean; isTop?: boolean },
) => {
  material.onBeforeCompile = (shader) => {
    Object.assign(
      shader.uniforms,
      topShadeUniforms,
      chandelierUniforms,
      diffuseRolloffUniforms,
      topFinishUniforms,
      isTop ? decorReflectionUniforms : {},
      isTop ? planarUniforms : {},
    );
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${VERTEX_DECLARATIONS}`,
      )
      .replace('#include <project_vertex>', VERTEX_WORLD_POSITION);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${FRAGMENT_DECLARATIONS}
${CHANDELIER_DECLARATIONS}
${DIFFUSE_ROLLOFF_DECLARATIONS}
${TOP_FINISH_DECLARATIONS}`,
      )
      .replace('#include <lights_fragment_end>', CHANDELIER_APPLY)
      .replace(
        OUTGOING_LIGHT,
        `${isTop ? TOP_DIFFUSE_SCALE : ''}
${DIFFUSE_ROLLOFF}
${OUTGOING_LIGHT}`,
      );
    if (isTop) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', TOP_VEIN_CURVE)
        .replace(
          '#include <common>',
          `#include <common>
${DECOR_REFLECTION_DECLARATIONS}
${PLANAR_DECLARATIONS}`,
        )
        .replace('#include <lights_fragment_maps>', DECOR_REFLECTION_PATCH)
        // After the decor patch, so it goes first: the decor (when on) covers it.
        .replace('#include <lights_fragment_maps>', PLANAR_PATCH);
    }
    if (underTop) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_maps>',
        ENVIRONMENT_CONTACT_PATCH,
      );
    }
    if (underTop) {
      shader.fragmentShader = applyTopCoverageToBaseLight(
        shader.fragmentShader,
      );
    }
  };
  // Its own compiled program, apart from materials without these patches.
  material.customProgramCacheKey = () =>
    underTop
      ? 'tableShading-base-contact-v6'
      : isTop
        ? 'tableShading-top-v3'
        : 'tableShading-v2';
  material.needsUpdate = true;
};
