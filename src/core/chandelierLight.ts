import * as THREE from 'three';

/**
 * Light from the room's ring chandelier (Room.tsx) on the table and chairs.
 *
 * The chandelier is three rings with a white LED strip underneath, hung
 * over the table (build_dining.py). Its light is baked into the room, but
 * the table and chairs are lit only by the studio HDR, so they showed
 * nothing of it. This shader adds, for each point of the table and chairs:
 * - the rings' light: each ring sampled at points round its circle, each a
 *   small downward-facing lamp, falling off with distance and angle;
 * - the rings' reflection: a glint where the mirrored view meets a ring,
 *   sharp on smooth surfaces, spread on rough ones;
 * - the top's shadow: what is under the table top gets no ring light
 *   (bases, chair seats tucked in), with a soft edge.
 *
 * It needs topShade.ts's declarations (world position, top footprint).
 */

/** The rings in three.js metres: [radius, height], round the room's centre. */
const RINGS: [number, number][] = [
  [0.55, 1.65],
  [0.85, 1.9],
  [1.15, 2.15],
];
/** Points sampled round each ring: more is smoother, but costs more. */
const RING_SAMPLES = 8;
/**
 * How much light the rings give the table and chairs, and how bright the
 * strips look in reflections (relative to the light). Tuned by eye
 * against the studio light the table also gets.
 */
export const CHANDELIER_STRENGTH = 0.2;
const REFLECTION_BRIGHTNESS = 20;
/** Half width of an LED strip, in metres. */
const STRIP_HALF_WIDTH = 0.008;
/** Neutral white, as the room's lights. */
const LED_COLOR = new THREE.Color(1, 0.99, 0.97);

/** Shared by every table and chair material. 0: off (the studio). */
export const chandelierUniforms = {
  uChandelierColor: { value: LED_COLOR },
  uChandelierRings: {
    value: RINGS.map(([r, h]) => new THREE.Vector2(r, h)),
  },
  uChandelierStrength: { value: 0 },
};

/** Turns the chandelier's light on the table and chairs on (room) or off. */
export const setChandelierStrength = (strength: number) => {
  chandelierUniforms.uChandelierStrength.value = strength;
};

export const CHANDELIER_DECLARATIONS = /* glsl */ `
uniform vec3 uChandelierColor;
uniform vec2 uChandelierRings[${RINGS.length}];
uniform float uChandelierStrength;

// 1 where the way from p to the lamp at s is clear of the table top, 0
// where the top is in the way; soft over a few centimetres.
float topClear(vec3 p, vec3 s) {
  if (p.y >= uTopUnderY - 0.001) return 1.0;
  float t = (uTopUnderY - p.y) / max(s.y - p.y, 1e-4);
  return smoothstep(-0.03, 0.03, topFootprintDistance(mix(p.xz, s.xz, t)));
}

// The rings' light and reflection reaching point p (world space), with
// normal n and view direction v, for the material's colours and roughness.
vec3 chandelierLight(
  vec3 p, vec3 n, vec3 v,
  vec3 diffuseColor, vec3 specularColor, float roughness
) {
  vec3 diffuse = vec3(0.0);
  vec3 r = reflect(-v, n);
  float glint = 0.0;
  for (int i = 0; i < ${RINGS.length}; i++) {
    float radius = uChandelierRings[i].x;
    float height = uChandelierRings[i].y;
    // Light: each sample stands for its share of the ring's length.
    float share = 6.2832 * radius / float(${RING_SAMPLES});
    for (int k = 0; k < ${RING_SAMPLES}; k++) {
      float a = (float(k) + 0.5) * 6.2832 / float(${RING_SAMPLES});
      // The chandelier hangs over the room's centre, where the table stands.
      vec3 s = vec3(radius * cos(a), height, radius * sin(a));
      vec3 toLamp = s - p;
      float d2 = max(dot(toLamp, toLamp), 1e-3);
      vec3 l = toLamp * inversesqrt(d2);
      // The strip faces down: it shines most straight below.
      float lit = max(dot(n, l), 0.0) * max(l.y, 0.0) / d2;
      diffuse += lit * share * topClear(p, s);
    }
    // Reflection: where the mirrored view crosses the ring's height, how
    // close it passes to the ring. Rough surfaces spread the strip wide.
    if (r.y > 0.0) {
      float t = (height - p.y) / r.y;
      if (t > 0.0) {
        vec3 q = p + r * t;
        float miss = abs(length(q.xz) - radius);
        float width = ${STRIP_HALF_WIDTH.toFixed(3)} + roughness * roughness * t * 0.5;
        glint += (${STRIP_HALF_WIDTH.toFixed(3)} / width)
          * exp(-miss * miss / (width * width)) * topClear(p, q);
      }
    }
  }
  vec3 fresnel = F_Schlick(specularColor, 1.0, max(dot(n, v), 0.0));
  return uChandelierColor * uChandelierStrength * (
    diffuse * diffuseColor * RECIPROCAL_PI
    + glint * fresnel * ${REFLECTION_BRIGHTNESS.toFixed(1)}
  );
}
`;

/** Added after the lights, so it adds to them. */
export const CHANDELIER_APPLY = /* glsl */ `
#include <lights_fragment_end>
if (uChandelierStrength > 0.0) {
  vec3 chandelierN = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 chandelierV = normalize(cameraPosition - vTopShadeWorldPosition);
  vec3 chandelier = chandelierLight(
    vTopShadeWorldPosition, chandelierN, chandelierV,
    material.diffuseColor, material.specularColor, material.roughness
  );
  reflectedLight.directDiffuse += chandelier;
}
`;
