/**
 * The room's light fixtures and the sun, in three.js metres, matching
 * pipeline/room/build_room.py. Blender is Z-up; the GLB is Y-up:
 * three (x, y, z) = Blender (x, z, -y), less the rug's 2 cm (Room.tsx).
 *
 * The room's own light is baked. These place the live lights that light
 * the table and chairs and cast their shadows, so the furniture is lit
 * from where the room's lamps and sun really are.
 */
import * as THREE from 'three';

const RUG_TOP = 0.02;
const fromBlender = (x: number, y: number, z: number) => new THREE.Vector3(x, z - RUG_TOP, -y);

/**
 * Chandelier (build_chandelier): a brass bar along x at 2.12 m with ten
 * globes on short arms. Each bulb sits at arm end + 2 cm + the globe's
 * radius (about 8 cm) along the arm.
 */
const BAR_Z = 2.12;
const ARMS: [number, [number, number, number]][] = [
  [-0.6, [-0.12, 0.08, 0.06]], [-0.45, [0.0, -0.17, -0.1]], [-0.3, [0.04, 0.13, 0.15]],
  [-0.16, [0.0, 0.06, -0.2]], [0.0, [0.0, -0.15, 0.1]], [0.13, [0.03, 0.15, -0.08]],
  [0.27, [0.0, -0.07, 0.2]], [0.4, [0.0, 0.16, 0.03]], [0.5, [0.05, -0.14, -0.12]],
  [0.61, [0.12, 0.05, 0.07]],
];
export const CHANDELIER_BULBS = ARMS.map(([x, d]) => {
  const dv = new THREE.Vector3(...d);
  const out = dv.length() + 0.02 + 0.0825;
  const p = dv.normalize().multiplyScalar(out);
  return fromBlender(x + p.x, p.y, BAR_Z + p.z);
});
/** The bulbs' centre: where the chandelier's one shadow-casting light sits. */
export const CHANDELIER_CENTRE = CHANDELIER_BULBS.reduce((a, b) => a.clone().add(b))
  .divideScalar(CHANDELIER_BULBS.length);

/** Floor lamp bulb (build_evening_lighting): RX - 0.35, CRED_Y - 1.75, 1.47. */
export const FLOOR_LAMP = fromBlender(4.3 - 0.35, 0.3 - 1.75, 1.47);

/** Warm bulbs, as in the bake (WARM_2700). */
export const WARM_2700 = new THREE.Color(1.0, 0.72, 0.45);

/**
 * The morning sun (SUN_ELEVATION 30 degrees, SUN_HEADING (-0.5, 0.85)):
 * the direction towards the sun, and its colour.
 */
const elev = (30 * Math.PI) / 180;
const heading = new THREE.Vector2(-0.5, 0.85).normalize();
export const TO_SUN = new THREE.Vector3(
  heading.x * Math.cos(elev),
  Math.sin(elev),
  -heading.y * Math.cos(elev),
).normalize();
export const SUN_COLOR = new THREE.Color(1.0, 0.96, 0.9);

/**
 * The glass wall the sun comes in through: the plane z = -3.15, open from
 * x -3.9 to 2.4 and from the floor to 2.95 m (GLASS_X0, GLASS_X1,
 * GLASS_TOP). The floor's shadow catcher uses it to show the furniture's
 * shadows only inside the sun patch (the rest of the floor is already in
 * the walls' baked shade).
 */
export const GLASS_WALL = { z: -3.15, x0: -3.9, x1: 2.4, top: 2.95 - RUG_TOP };
