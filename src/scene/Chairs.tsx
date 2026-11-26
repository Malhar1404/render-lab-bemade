import { useGLTF, useTexture } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { addBoxProjection } from '../core/boxProjection';
import { CHAIR_URL, type ChairColour, type TopShape, chairTextureUrls } from '../config/table';

/**
 * Aria chairs around the table, placed as the configurator places them:
 * one at each end of a long top and the rest shared by the long sides, or
 * evenly round a round top.
 */

type Props = {
  count: number;
  colour: ChairColour;
  shape: TopShape;
  /** The top's footprint (world). */
  bounds: THREE.Box3;
  probe: THREE.Texture | null;
  envIntensity: number;
};

type Placement = { x: number; z: number; rotY: number };

/** Chair seat width (the Top mesh's bounding box). */
const CHAIR_WIDTH = 0.472;

const spread = (length: number, count: number) => {
  const gap = (length - count * CHAIR_WIDTH) / (count + 1);
  return Array.from({ length: count }, (_, i) => gap + i * (gap + CHAIR_WIDTH));
};

const placeRect = (box: THREE.Box3, count: number): Placement[] => {
  const w = CHAIR_WIDTH;
  const ends = count >= 4 ? 2 : 0;
  const sides = count - ends;
  const front = Math.ceil(sides / 2);
  const back = sides - front;
  const length = box.max.x - box.min.x;
  const out: Placement[] = [];
  spread(length, front).forEach((p) => out.push({ x: box.min.x + p + w / 2, z: box.max.z + w / 2, rotY: Math.PI }));
  spread(length, back).forEach((p) => out.push({ x: box.min.x + p + w / 2, z: box.min.z - w / 2, rotY: 0 }));
  if (ends) {
    out.push({ x: box.max.x + w / 2, z: 0, rotY: -Math.PI / 2 });
    out.push({ x: box.min.x - w / 2, z: 0, rotY: Math.PI / 2 });
  }
  return out;
};

const placeRound = (box: THREE.Box3, count: number): Placement[] => {
  const rx = (box.max.x - box.min.x) / 2 + CHAIR_WIDTH / 2;
  const rz = (box.max.z - box.min.z) / 2 + CHAIR_WIDTH / 2;
  return Array.from({ length: count }, (_, i) => {
    const a = Math.PI / 4 + (i / count) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const z = Math.sin(a) * rz;
    // The chair faces +z: turn it to face the centre.
    return { x, z, rotY: Math.atan2(-x, -z) };
  });
};

const useChairMaterial = (colour: ChairColour, part: 'Top' | 'Leg') => {
  const urls = chairTextureUrls(colour, part);
  const textures = useTexture(urls);
  return useMemo(() => {
    Object.entries(textures).forEach(([key, t]) => {
      t.flipY = false;
      t.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
    });
    const m = new THREE.MeshStandardMaterial({
      ...textures,
      metalness: 0,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    addBoxProjection(m);
    return m;
  }, [textures]);
};

export const Chairs = ({ count, colour, shape, bounds, probe, envIntensity }: Props) => {
  const { scene } = useGLTF(CHAIR_URL);
  const fabric = useChairMaterial(colour, 'Top');
  const legs = useChairMaterial(colour, 'Leg');

  useEffect(() => {
    [fabric, legs].forEach((m) => {
      if (m.envMap !== probe) {
        m.envMap = probe;
        m.needsUpdate = true;
      }
      m.envMapIntensity = envIntensity;
    });
  }, [fabric, legs, probe, envIntensity]);

  const placements = useMemo(
    () => (bounds.isEmpty() ? [] : shape === 'round' ? placeRound(bounds, count) : placeRect(bounds, count)),
    [bounds, count, shape],
  );

  const chairs = useMemo(
    () =>
      placements.map(() => {
        const c = scene.clone(true);
        c.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.material = o.name === 'Top' ? fabric : legs;
          o.castShadow = true;
          o.receiveShadow = true;
        });
        return c;
      }),
    [placements, scene, fabric, legs],
  );

  return (
    <group>
      {chairs.map((c, i) => (
        <primitive
          key={i}
          object={c}
          position={[placements[i].x, 0, placements[i].z]}
          rotation={[0, placements[i].rotY, 0]}
        />
      ))}
    </group>
  );
};
