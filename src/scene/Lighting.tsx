import { ContactShadows } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

/** A mood's 360 probe, ready to light and reflect (equirect mapping). */
export const useProbe = (url: string) => {
  const texture = useLoader(RGBELoader, url);
  return useMemo(() => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    return texture;
  }, [texture]);
};

type Props = {
  keyIntensity: number;
  softShadow: number;
  contactShadow: number;
};

/**
 * The live light on the furniture (the room's own light is baked): one soft
 * key light from above for the table's and chairs' shadows on each other,
 * and contact shadows on the floor (the baked room has no furniture in it).
 * Values from the configurator's FurnitureKeyLight and contact shadows.
 */
export const Lighting = ({ keyIntensity, softShadow, contactShadow }: Props) => (
  <>
    <directionalLight
      castShadow
      color="#fff5e6"
      intensity={keyIntensity}
      position={[0.4, 3.5, 1.2]}
      shadow-bias={-0.00015}
      shadow-normalBias={0.015}
      shadow-radius={6}
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-3}
      shadow-camera-right={3}
      shadow-camera-top={3}
      shadow-camera-bottom={-2}
      shadow-camera-far={7}
    />
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
