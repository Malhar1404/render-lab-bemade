import { useLoader, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

/**
 * The garden behind the glass wall: the same sky picture Blender lit the
 * bake with (pipeline/room/out/env/garden_4k.hdr, its sun painted out),
 * as the scene's background. Without it the window was black and the room
 * looked flat next to the Blender renders.
 *
 * Blender's equirect layout puts the picture's centre where three.js has
 * its edge, so it is turned half a turn to line up with the bake.
 */
const GARDEN_URL = '/env/garden_2k.hdr';

export const Garden = ({ intensity }: { intensity: number }) => {
  const texture = useLoader(RGBELoader, GARDEN_URL);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.backgroundRotation.set(0, Math.PI, 0);
    return () => {
      if (scene.background === texture) scene.background = null;
    };
  }, [scene, texture]);

  useEffect(() => {
    scene.backgroundIntensity = intensity;
  }, [scene, intensity]);

  return null;
};
