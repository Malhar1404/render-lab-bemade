import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { addBoxProjection } from '../core/boxProjection';

/**
 * The dining room around the table, built and baked in Blender
 * (pipeline/room): its light is baked into light maps (one set per mood),
 * so it needs no lights. No furniture is in the bake; the table's and
 * chairs' shadows are drawn live.
 */

/** The rug's top is the floor the furniture stands on (y = 0). */
const RUG_TOP = 0.02;

/**
 * Glossy surfaces: they reflect the room as well as showing their baked
 * light. Keyed by a part of the GLB material name (<group>_<material>).
 */
type Gloss = { metalness?: number; roughness: number };
const GLOSSY: Record<string, Gloss> = {
  black_metal: { metalness: 0.6, roughness: 0.4 },
  credenza_brass: { metalness: 1, roughness: 0.3 },
  credenza_marble: { roughness: 0.12 },
  credenza_walnut: { roughness: 0.45 },
  floor_oak: { roughness: 0.5 },
  window_frame: { roughness: 0.4 },
};

/**
 * The environment only reflects on the room: its light is all baked. The
 * live lights (Lighting.tsx) are for the furniture only: drop their direct
 * light here, or the room would get its lamps and sun twice.
 */
const reflectionsOnly = (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <lights_fragment_maps>',
      THREE.ShaderChunk.lights_fragment_maps.replace(
        'iblIrradiance += getIBLIrradiance( geometryNormal );',
        '',
      ),
    )
    .replace(
      '#include <lights_fragment_end>',
      `reflectedLight.directDiffuse = vec3(0.0);
reflectedLight.directSpecular = vec3(0.0);
#include <lights_fragment_end>`,
    );
};

/**
 * RGBM light maps (day, since 2026-11-27; pipeline/room/post_bake.py
 * encode_rgbm): colour x alpha in gamma 2.2, times RGBM_RANGE, is the light
 * itself. 8-bit sRGB of light / 4 had too few steps in the dark corners.
 */
const RGBM_RANGE = 4;
const RGBM_DECODE = /* glsl */ `
vec4 decodeRGBM(vec4 t) {
  return vec4(pow(max(t.rgb * t.a, vec3(0.0)), vec3(2.2)) * ${RGBM_RANGE.toFixed(1)}, 1.0);
}
`;
const decodeLightMap = (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
${RGBM_DECODE}`)
    .replace(
      '#include <lights_fragment_maps>',
      THREE.ShaderChunk.lights_fragment_maps,
    )
    .split('texture2D( lightMap, vLightMapUv )')
    .join('decodeRGBM( texture2D( lightMap, vLightMapUv ) )');
};

const CHANDELIER_NAME = 'chandelier';
/** Hide the chandelier within this angle of looking straight down. */
const CHANDELIER_HIDE_ANGLE = (40 * Math.PI) / 180;
const TABLE_CENTRE = new THREE.Vector3(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);
const toCamera = new THREE.Vector3();

type Props = {
  url: string;
  /** The room's probe (reflections on its glossy surfaces). */
  probe: THREE.Texture | null;
  /** Brightness of the baked light. */
  exposure: number;
  /** The light maps hold light / lightScale (the mood's encoding). */
  lightScale: number;
  /** Light maps are RGBM (the light itself), not sRGB light / lightScale. */
  rgbm: boolean;
};

export const Room = ({ url, probe, exposure, lightScale, rgbm }: Props) => {
  const { scene } = useGLTF(url);
  const anisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());

  // Convert the GLB's materials once per loaded scene.
  const baked = useMemo(() => {
    const list: THREE.Material[] = [];
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.converted) return;
      o.userData.converted = true;
      const src = o.material as THREE.MeshStandardMaterial;
      if (src.map) src.map.anisotropy = anisotropy;
      const lightMap = src.emissiveMap;
      // Baked into its points, not a light map (the potted plant: its
      // leaves are too many and too small for an image). Same encoding,
      // light / lightScale; the exposure effect below scales it back.
      if (!lightMap && o.geometry.attributes.color) {
        if (src.map) src.map.anisotropy = anisotropy;
        const m = new THREE.MeshBasicMaterial({
          alphaTest: src.alphaTest,
          map: src.map,
          name: src.name,
          side: src.side,
          transparent: src.transparent,
          vertexColors: true,
        });
        m.userData.pointLight = true;
        m.userData.albedo = src.color.clone();
        src.dispose();
        o.material = m;
        o.castShadow = false;
        o.receiveShadow = false;
        list.push(m);
        return;
      }
      if (!lightMap) {
        // Glass, chandelier, bulbs: their own physical material.
        o.userData.unbaked = true;
        return;
      }
      lightMap.anisotropy = anisotropy;
      if (rgbm) {
        // Encoded light: read the bytes as they are.
        lightMap.colorSpace = THREE.NoColorSpace;
        lightMap.needsUpdate = true;
      }
      const shared = {
        alphaTest: src.alphaTest,
        color: src.color,
        depthWrite: src.depthWrite,
        lightMap,
        map: src.map,
        name: src.name,
        opacity: src.opacity,
        side: src.side,
        transparent: src.transparent,
      };
      const key = Object.keys(GLOSSY).find((k) => src.name.includes(k));
      let m: THREE.Material;
      if (key) {
        const g = new THREE.MeshStandardMaterial({
          ...shared,
          envMapIntensity: 1,
          metalness: GLOSSY[key].metalness ?? 0,
          roughness: GLOSSY[key].roughness,
        });
        g.onBeforeCompile = (shader) => {
          reflectionsOnly(shader);
          if (rgbm) decodeLightMap(shader);
        };
        addBoxProjection(g);
        m = g;
      } else {
        m = new THREE.MeshBasicMaterial(shared);
        if (rgbm) {
          m.onBeforeCompile = decodeLightMap;
          m.customProgramCacheKey = () => 'room-basic-rgbm';
        }
      }
      src.dispose();
      o.material = m;
      o.castShadow = false;
      o.receiveShadow = false;
      list.push(m);
    });
    return list;
  }, [scene, anisotropy, rgbm]);

  // Exposure and the probe can change live (lab controls, mood switch).
  useEffect(() => {
    // RGBM maps hold the light itself; the old ones light / lightScale.
    const intensity = (rgbm ? 1 : lightScale) * Math.PI * exposure;
    const pointIntensity = lightScale * exposure;
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      if ('lightMapIntensity' in m && m.lightMap) m.lightMapIntensity = intensity;
      // Point-baked light: colour = albedo x lightScale x exposure (a light
      // map's intensity includes a pi that its shader takes back out).
      if (m.userData.pointLight) m.color.copy(m.userData.albedo).multiplyScalar(pointIntensity);
      if (m instanceof THREE.MeshStandardMaterial && m.envMap !== probe) {
        m.envMap = probe;
        m.needsUpdate = true;
      }
    });
  }, [scene, baked, exposure, lightScale, rgbm, probe]);

  const chandelier = useMemo(() => scene.getObjectByName(CHANDELIER_NAME), [scene]);
  useFrame(({ camera }) => {
    if (!chandelier) return;
    toCamera.subVectors(camera.position, TABLE_CENTRE);
    chandelier.visible = toCamera.angleTo(UP) > CHANDELIER_HIDE_ANGLE;
  });

  return <primitive object={scene} position={[0, -RUG_TOP, 0]} />;
};
