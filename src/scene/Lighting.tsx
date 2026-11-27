import { ContactShadows, SoftShadows } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

import {
  CHANDELIER_CENTRE,
  FLOOR_LAMP,
  GLASS_WALL,
  SUN_COLOR,
  TO_SUN,
  WARM_2700,
} from '../config/fixtures';

/** A mood's 360 probe, ready to light and reflect (equirect mapping). */
export const useProbe = (url: string) => {
  const texture = useLoader(RGBELoader, url);
  return useMemo(() => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    return texture;
  }, [texture]);
};

export type LiveLights = {
  /**
   * The sun through the glass wall (day), from the bake's direction. The
   * Blender renders show its patch crossing the table and rug. Its strength
   * matches the bake: Blender's sun (5.02 x 0.65) x the room exposure (2.46),
   * about 8. 0: off.
   */
  sun: number;
  /** The chandelier over the table (evening), in candela. 0: off. */
  chandelier: number;
  /** The floor lamp (evening), in candela. 0: off. */
  lamp: number;
  /** Darkness of the furniture's shadows on the floor from these lights. */
  floorShadow: number;
};

type Props = LiveLights & {
  /** The baked light on the floor, in the live lights' units (MoodConfig.floorLight). */
  floorLight: number;
  /** Shadow softness (PCSS light size): small by day (the sun), large by evening (the chandelier bar). */
  shadowSoftness: number;
  softShadow: number;
  contactShadow: number;
};

/**
 * The live light on the furniture. The room's own light is baked, so these
 * light only the table and chairs (Room.tsx keeps them off its surfaces),
 * from where the bake's sun and lamps really are, and cast the furniture's
 * shadows on each other and, through a shadow catcher, on the floor.
 * Shadows are soft and harden near contact (PCSS).
 * The two contact shadows stay as soft grounding under the furniture.
 */
export const Lighting = ({
  sun,
  chandelier,
  lamp,
  floorShadow,
  floorLight,
  shadowSoftness,
  softShadow,
  contactShadow,
}: Props) => {
  // Spot and directional lights aim at a target object, which must be in the scene.
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const chandelierTarget = useMemo(() => {
    const t = new THREE.Object3D();
    t.position.set(CHANDELIER_CENTRE.x, 0, CHANDELIER_CENTRE.z);
    return t;
  }, []);
  const sunPosition = useMemo(() => TO_SUN.clone().multiplyScalar(8).toArray(), []);

  return (
    <>
      {/* The sun is small (sharp shadows); the chandelier a 1.2 m bar (very soft). */}
      <SoftShadows size={shadowSoftness} samples={10} focus={0.5} />
      <primitive object={sunTarget} />
      <primitive object={chandelierTarget} />
      {sun > 0 && (
        <directionalLight
          castShadow
          color={SUN_COLOR}
          intensity={sun}
          position={sunPosition}
          target={sunTarget}
          shadow-bias={-0.0002}
          shadow-normalBias={0.02}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-3.5}
          shadow-camera-right={3.5}
          shadow-camera-top={3.5}
          shadow-camera-bottom={-3.5}
          shadow-camera-near={1}
          shadow-camera-far={16}
        />
      )}
      {chandelier > 0 && (
        <spotLight
          castShadow
          color={WARM_2700}
          intensity={chandelier}
          decay={2}
          angle={1.2}
          penumbra={1}
          position={CHANDELIER_CENTRE.toArray()}
          target={chandelierTarget}
          shadow-bias={-0.0002}
          shadow-normalBias={0.02}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-near={0.2}
          shadow-camera-far={5}
        />
      )}
      {lamp > 0 && (
        // No shadows: the lamp is far off and shaded, its shadows would be
        // faint, and a point light's shadow is six extra renders a frame.
        <pointLight
          color={WARM_2700}
          intensity={lamp}
          decay={2}
          position={FLOOR_LAMP.toArray()}
        />
      )}
      <FloorShadows strength={floorShadow} sun={sun} chandelier={chandelier} floorLight={floorLight} />
      <ContactShadows
        position={[0, 0.001, 0]}
        blur={1.5}
        color="#34363d"
        far={3}
        frames={120}
        opacity={softShadow}
        resolution={1024}
        scale={6}
      />
      <ContactShadows
        position={[0, 0.002, 0]}
        blur={0.8}
        color="#4c4f57"
        far={0.12}
        frames={120}
        opacity={contactShadow}
        resolution={1024}
        scale={5}
      />
    </>
  );
};

/**
 * A see-through floor that darkens the baked floor by the light the
 * furniture blocks, and no more. At each point it works out how much light
 * the sun and the chandelier bring (by distance and angle; the sun only
 * inside its patch, where the way to it passes through the glass wall, with
 * soft edges as the bake has), how much of that the shadow maps say is blocked,
 * and compares it with all the light there (the baked light plus theirs):
 *   darkness = blocked light / (baked light + live light).
 * So a shadow is deep only where its light dominates, and fades with
 * distance from the light, as a real one does.
 */
type FloorShadowProps = { strength: number; sun: number; chandelier: number; floorLight: number };

const FloorShadows = ({ strength, sun, chandelier, floorLight }: FloorShadowProps) => {
  const material = useMemo(() => {
    const m = new THREE.ShadowMaterial({ color: 0x14161b, depthWrite: false });
    m.userData.uniforms = {
      uSun: { value: 0 },
      uToSun: { value: TO_SUN },
      uGlass: { value: new THREE.Vector4(GLASS_WALL.z, GLASS_WALL.x0, GLASS_WALL.x1, GLASS_WALL.top) },
      uSpot: { value: 0 },
      uSpotPos: { value: CHANDELIER_CENTRE },
      uFloorLight: { value: 1 },
    };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, m.userData.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFloorWorld;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvFloorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vFloorWorld;
uniform float uSun;
uniform vec3 uToSun;
uniform float uSpot;
uniform vec3 uSpotPos;
uniform float uFloorLight;
uniform vec4 uGlass; // plane z, x from, x to, top

// 1 where the way to the sun passes through the glass wall; soft edges
// (the sun's size over the few metres to the glass, as in the bake).
float sunPatch(vec3 p) {
  float t = (uGlass.x - p.z) / min(uToSun.z, -1e-4);
  vec3 q = p + uToSun * t;
  float edge = 0.12;
  return smoothstep(uGlass.y - edge, uGlass.y + edge, q.x)
    * (1.0 - smoothstep(uGlass.z - edge, uGlass.z + edge, q.x))
    * (1.0 - smoothstep(uGlass.w - edge, uGlass.w + edge, q.y));
}
`,
        )
        .replace(
          '#include <shadowmask_pars_fragment>',
          `#include <shadowmask_pars_fragment>
// Share of all the light here that the furniture blocks.
float blockedShare(vec3 p) {
  float sunLight = uSun * max(uToSun.y, 0.0) * sunPatch(p);
  vec3 toSpot = uSpotPos - p;
  float d2 = max(dot(toSpot, toSpot), 1e-3);
  float spotLight = uSpot * max(toSpot.y, 0.0) * inversesqrt(d2) / d2;
  float blocked = 0.0;
  #ifdef USE_SHADOWMAP
  #if NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow dl = directionalLightShadows[ 0 ];
    blocked += sunLight * (1.0 - getShadow( directionalShadowMap[ 0 ], dl.shadowMapSize, dl.shadowIntensity, dl.shadowBias, dl.shadowRadius, vDirectionalShadowCoord[ 0 ] ));
  #endif
  #if NUM_SPOT_LIGHT_SHADOWS > 0
    SpotLightShadow sl = spotLightShadows[ 0 ];
    blocked += spotLight * (1.0 - getShadow( spotShadowMap[ 0 ], sl.shadowMapSize, sl.shadowIntensity, sl.shadowBias, sl.shadowRadius, vSpotLightCoord[ 0 ] ));
  #endif
  #endif
  return blocked / (uFloorLight + sunLight + spotLight);
}`,
        )
        .replace('opacity * ( 1.0 - getShadowMask() )', 'opacity * blockedShare(vFloorWorld)');
    };
    m.customProgramCacheKey = () => 'floor-shadows-v4';
    return m;
  }, []);

  useEffect(() => {
    const u = material.userData.uniforms;
    material.opacity = strength;
    u.uSun.value = sun;
    u.uSpot.value = chandelier;
    u.uFloorLight.value = floorLight;
  }, [material, strength, sun, chandelier, floorLight]);

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.003, 0]} receiveShadow material={material} renderOrder={1}>
      <planeGeometry args={[8.6, 6.2]} />
    </mesh>
  );
};
