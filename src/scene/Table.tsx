import { useGLTF, useTexture } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { addBoxProjection } from '../core/boxProjection';
import { renderTopReflection } from '../core/planarReflection';
import { applyTableShading, getTopBounds, updateTopShade } from '../core/topShade';
import {
  BASE_FINISHES,
  type BaseFinishId,
  type BaseShape,
  TOP_COLOURS,
  type TopColour,
  type TopShape,
  baseColourMapUrl,
  baseUrl,
  topRoughness,
  topTextureUrls,
  topUrls,
} from '../config/table';

/**
 * The table: top slab, the MDF board under it, and the base, with the
 * configurator's materials and shader patches (topShade.ts), plus box
 * projection so the room reflects where it really is.
 */

export type TableLight = {
  /** The probe: lights and reflects in every table material. */
  probe: THREE.Texture | null;
  topEnv: number;
  baseEnv: number;
};

type Props = TableLight & {
  top: TopShape;
  base: BaseShape;
  colour: TopColour;
  baseFinish: BaseFinishId;
};

/** Texture set-up the configurator uses for its GLB-mapped textures. */
const prepare = (t: THREE.Texture, anisotropy: number, srgb = false) => {
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
};

/** Every mesh of a GLB scene, cloned so each setup has its own. */
const meshesOf = (scene: THREE.Object3D) => {
  const clone = scene.clone(true);
  const meshes: THREE.Mesh[] = [];
  clone.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  return { clone, meshes };
};

const setEnv = (m: THREE.MeshStandardMaterial, probe: THREE.Texture | null, intensity: number) => {
  if (m.envMap !== probe) {
    m.envMap = probe;
    m.needsUpdate = true;
  }
  m.envMapIntensity = intensity;
};

export const Table = ({ top, base, colour, baseFinish, probe, topEnv, baseEnv }: Props) => {
  const anisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const urls = topUrls(top);
  const topGltf = useGLTF(urls.top);
  const mdfGltf = useGLTF(urls.mdf);
  const baseGltf = useGLTF(baseUrl(base));
  const finish = BASE_FINISHES[baseFinish];
  const tex = topTextureUrls(colour);
  const [map, normalMap, roughnessMap, mdfMap, baseMap] = useTexture([
    tex.map,
    tex.normal,
    tex.roughness,
    tex.mdf,
    baseColourMapUrl(base, finish),
  ]);

  // The top: polished stone with a clear coat (configurator values).
  const topMaterial = useMemo(() => {
    prepare(map, anisotropy, true);
    prepare(normalMap, anisotropy);
    prepare(roughnessMap, anisotropy);
    const c = TOP_COLOURS[colour];
    const m = new THREE.MeshPhysicalMaterial({
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      color: new THREE.Color(1, 1, 1).multiplyScalar(c.brightness),
      map,
      metalness: 0,
      normalMap,
      roughness: topRoughness(c),
      roughnessMap,
      side: THREE.DoubleSide,
    });
    applyTableShading(m, { isTop: true, underTop: false });
    addBoxProjection(m);
    return m;
  }, [colour, map, normalMap, roughnessMap, anisotropy]);

  const mdfMaterial = useMemo(() => {
    prepare(mdfMap, anisotropy, true);
    const m = new THREE.MeshStandardMaterial({ map: mdfMap, roughness: 0.6 });
    applyTableShading(m, { underTop: true });
    addBoxProjection(m);
    return m;
  }, [mdfMap, anisotropy]);

  const baseMaterial = useMemo(() => {
    prepare(baseMap, anisotropy, true);
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(...finish.color),
      map: 'colourMap' in finish && finish.colourMap ? baseMap : null,
      metalness: finish.metalness,
      roughness: finish.roughness,
    });
    applyTableShading(m, { underTop: true });
    addBoxProjection(m);
    return m;
  }, [finish, baseMap, anisotropy]);

  const topObject = useMemo(() => {
    const g = new THREE.Group();
    const slab = meshesOf(topGltf.scene);
    slab.meshes.forEach((mesh) => (mesh.material = topMaterial));
    const mdf = meshesOf(mdfGltf.scene);
    mdf.meshes.forEach((mesh) => (mesh.material = mdfMaterial));
    [...slab.meshes, ...mdf.meshes].forEach((mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    g.add(slab.clone, mdf.clone);
    return g;
  }, [topGltf.scene, mdfGltf.scene, topMaterial, mdfMaterial]);

  const baseObject = useMemo(() => {
    const b = meshesOf(baseGltf.scene);
    b.meshes.forEach((mesh) => {
      mesh.material = baseMaterial;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return b.clone;
  }, [baseGltf.scene, baseMaterial]);

  useEffect(() => {
    setEnv(topMaterial, probe, topEnv);
    setEnv(mdfMaterial, probe, baseEnv);
    setEnv(baseMaterial, probe, baseEnv);
  }, [topMaterial, mdfMaterial, baseMaterial, probe, topEnv, baseEnv]);

  useEffect(
    () => () => {
      topMaterial.dispose();
      mdfMaterial.dispose();
      baseMaterial.dispose();
    },
    [topMaterial, mdfMaterial, baseMaterial],
  );

  // The base's contact shade and the top's roll-off follow the top's bounds.
  const topRef = useRef<THREE.Group>(null);
  const tableRef = useRef<THREE.Group>(null);
  useFrame(({ gl, scene, camera }) => {
    if (!topRef.current) return;
    updateTopShade(topRef.current);
    // The room mirrored in the top (planarReflection.ts), before the frame.
    const bounds = getTopBounds();
    if (!bounds.isEmpty() && tableRef.current) {
      renderTopReflection(gl, scene, camera, bounds.max.y, [tableRef.current]);
    }
  });

  return (
    <group ref={tableRef}>
      <group ref={topRef}>
        <primitive object={topObject} />
      </group>
      <primitive object={baseObject} />
    </group>
  );
};
