/**
 * Lighting moods. Each is baked separately in Blender (pipeline/room):
 * its own room light maps (in the room GLB) and its own 360 probe, which
 * lights and reflects in the table and chairs.
 */
export type Mood = 'day' | 'evening';

export type MoodConfig = {
  label: string;
  /** The baked room for this mood. */
  roomUrl: string;
  /** 360 probe from just above the table (lights the table and chairs). */
  probeUrl: string;
  /** Brightness of the baked room (light maps hold light / 4). */
  roomExposure: number;
  /** Strength of the probe's light on the table and chairs. */
  tableEnvIntensity: number;
};

export const MOODS: Record<Mood, MoodConfig> = {
  day: {
    label: 'Day',
    probeUrl: '/env/room_2k.hdr',
    roomExposure: 1.46,
    roomUrl: '/assets/room/room_v2.glb',
    tableEnvIntensity: 2.2,
  },
  evening: {
    label: 'Evening',
    // Placeholder: the day files until the evening bake exists
    // (then /env/room_evening_2k.hdr and /assets/room/room_evening.glb).
    probeUrl: '/env/room_2k.hdr',
    roomExposure: 1.46,
    roomUrl: '/assets/room/room_v2.glb',
    tableEnvIntensity: 2.2,
  },
};

/**
 * The room as a box, for box-projected reflections (parallax-corrected
 * probe): its centre and size in three.js metres, matching
 * pipeline/room/build_room.py (RX, RY, H) with the floor at y = 0.
 */
export const ROOM_BOX = {
  centre: [0, 1.6, 0] as [number, number, number],
  size: [8.6, 3.2, 6.2] as [number, number, number],
};

/** Where the probe was rendered from (bake_room.py render_probe). */
export const PROBE_POSITION: [number, number, number] = [0, 0.85, 0];
