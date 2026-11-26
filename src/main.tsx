import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';

import { App } from './App';
import { PROBE_POSITION, ROOM_BOX } from './config/moods';
import { setBoxProjection } from './core/boxProjection';
import { setChandelierStrength } from './core/chandelierLight';
import './index.css';

// The room box and probe position every box-projected material uses.
setBoxProjection({
  boxCentre: new THREE.Vector3(...ROOM_BOX.centre),
  boxSize: new THREE.Vector3(...ROOM_BOX.size),
  probePosition: new THREE.Vector3(...PROBE_POSITION),
});
// The old room's chandelier glints: the new room's chandelier is in the probe.
setChandelierStrength(0);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
