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
  /** Brightness of the baked room. */
  roomExposure: number;
  /**
   * The light maps hold light / lightScale (pipeline/room/post_bake.py
   * LIGHT_SCALE): 4 by day, 2 for the dimmer evening.
   */
  lightScale: number;
  /** Strength of the probe's light on the table and chairs. */
  tableEnvIntensity: number;
  /**
   * Starting strengths of the live lights on the furniture (Lighting.tsx):
   * the sun by day, the chandelier and floor lamp by evening. Tune by eye.
   */
  lights: { sun: number; chandelier: number; lamp: number };
  /**
   * The baked light on the floor, in the live lights' units: how deep the
   * furniture's floor shadows get (Lighting.tsx FloorShadows). Higher: fainter.
   */
  floorLight: number;
  /** Shadow softness (PCSS light size): small for the sun, large for the chandelier. */
  shadowSoftness: number;
  /**
   * Brightness of the garden behind the glass (the bake's sky picture,
   * public/env/garden_2k.hdr): Blender's sky strength x the room exposure.
   */
  garden: number;
  /**
   * Light maps are RGBM-encoded (the light itself, lossless; day since
   * 2026-11-27) rather than sRGB light / lightScale (evening, until rebaked).
   */
  rgbm: boolean;
};

export const MOODS: Record<Mood, MoodConfig> = {
  day: {
    label: 'Day',
    probeUrl: '/env/room_2k.hdr',
    // Blender's target renders use AgX at +1.3 stops: 2 ^ 1.3 = 2.46. The
    // RGBM light maps hold the light itself, so this matches them directly
    // (2026-11-27; it was 1.46 under Neutral tone mapping).
    roomExposure: 2.46,
    lightScale: 4,
    roomUrl: '/assets/room/room_v2.glb',
    // Scaled with the room exposure (was 2.2 at 1.46).
    tableEnvIntensity: 3.7,
    // Sun: Blender's 5.02 x 0.65 x room exposure 2.46 (Lighting.tsx).
    lights: { sun: 8, chandelier: 0, lamp: 0 },
    // The sky's and bounced light on the floor, in the live lights' units
    // (baked floor light outside the sun x pi x exposure): sets how deep the
    // sun's shadows on the floor go.
    floorLight: 1.2,
    shadowSoftness: 8,
    garden: 11,
    rgbm: true,
  },
  evening: {
    label: 'Evening',
    // Late dusk, lamps on (pipeline/room: run_evening.sh). Its raw light is
    // 0.6-0.95 of day's but pooled round the lamps; shown about 40% darker
    // than day, as an evening photo would be. Starting values: tune by eye.
    probeUrl: '/env/room_evening_2k.hdr',
    roomExposure: 1.1,
    lightScale: 2,
    roomUrl: '/assets/room/room_evening.glb',
    tableEnvIntensity: 1.65,
    lights: { sun: 0, chandelier: 4, lamp: 2 },
    floorLight: 1.5,
    shadowSoftness: 40,
    // Dusk: the sky at 0.2 x exposure 1.1.
    garden: 0.22,
    rgbm: false,
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
