/**
 * The few table setups the lab compares, and the finishes ported from the
 * configurator (demo-bemade MaterialManager / configuratorData). Every top
 * and base is shown at its model's native (largest) size.
 */
const IMG = '/assets/images';

export type TopShape = 'oblong' | 'capsule' | 'round';
export type BaseShape = 'moon' | 'linea' | 'linea-dome';
export type TopColour = 'calacatta_lux' | 'calacatta_black' | 'noce';

export type Setup = {
  label: string;
  top: TopShape;
  base: BaseShape;
  baseFinish: BaseFinishId;
  chairs: number;
};

export const SETUPS = {
  oblongMoon: { label: 'Oblong + Moon', top: 'oblong', base: 'moon', baseFinish: 'moon-cloth-grey', chairs: 6 },
  capsuleLinea: { label: 'Capsule + Linea', top: 'capsule', base: 'linea', baseFinish: 'linea-gold', chairs: 6 },
  roundDome: { label: 'Round + Linea Dome', top: 'round', base: 'linea-dome', baseFinish: 'linea-dome-gold', chairs: 4 },
} satisfies Record<string, Setup>;
export type SetupId = keyof typeof SETUPS;

export const topUrls = (shape: TopShape) => ({
  top: `${IMG}/top-shape/${shape}/model.glb`,
  mdf: `${IMG}/top-shape/${shape}/model-mdf.glb`,
});

/** Each top's footprint, half length and half width (from its GLB). */
export const TOP_HALF_SIZE: Record<TopShape, [number, number]> = {
  capsule: [1.598, 0.628],
  oblong: [1.598, 0.628],
  round: [0.79, 0.79],
};

export const baseUrl = (shape: BaseShape) => `${IMG}/base-shape/${shape}/model.glb`;

/** Roughness map level by finish type (configurator ROUGHNESS_MAP_LEVEL). */
const ROUGHNESS_MAP_LEVEL = { matte: 0.8, silk: 0.4, polished: 0.094 };

export type TopColourConfig = {
  label: string;
  /** Multiplies the white base colour (configurator "brightness"). */
  brightness: number;
  finish: keyof typeof ROUGHNESS_MAP_LEVEL;
};

export const TOP_COLOURS: Record<TopColour, TopColourConfig> = {
  calacatta_lux: { label: 'Calacatta Lux (polished)', brightness: 0.94, finish: 'polished' },
  calacatta_black: { label: 'Calacatta Black (matte)', brightness: 1, finish: 'matte' },
  noce: { label: 'Noce (silk)', brightness: 1, finish: 'silk' },
};

/** The roughness that scales the colour's roughness map. */
export const topRoughness = (c: TopColourConfig) => 0.08 / ROUGHNESS_MAP_LEVEL[c.finish];

export const topTextureUrls = (colour: TopColour) => {
  const dir = `${IMG}/top-color/${colour}`;
  return {
    map: `${dir}/base_color.webp`,
    mdf: `${dir}/mdf_color.webp`,
    normal: `${dir}/normal.webp`,
    roughness: `${dir}/roughness.webp`,
  };
};

export type BaseFinish = {
  /** Colour folder (color1 / color2) the base's textures come from. */
  folder: 'color1' | 'color2';
  color: [number, number, number];
  metalness: number;
  roughness: number;
  /** Keep the folder's colour map (else a plain colour). */
  colourMap?: boolean;
};

export const BASE_FINISHES = {
  'moon-cloth-grey': { folder: 'color1', color: [2.04, 2.04, 2.08], metalness: 1, roughness: 0.45, colourMap: true },
  'moon-cloth-gold': { folder: 'color2', color: [0.92, 0.84, 0.22], metalness: 1, roughness: 0.32 },
  'linea-gold': { folder: 'color1', color: [0.92, 0.72, 0.32], metalness: 1, roughness: 0.28 },
  'linea-book-black': { folder: 'color2', color: [0.025, 0.025, 0.027], metalness: 0, roughness: 0.42 },
  'linea-dome-gold': { folder: 'color1', color: [0.92, 0.72, 0.32], metalness: 1, roughness: 0.28 },
  'linea-dome-black': { folder: 'color2', color: [0.025, 0.025, 0.027], metalness: 0, roughness: 0.42 },
} satisfies Record<string, BaseFinish>;
export type BaseFinishId = keyof typeof BASE_FINISHES;

export const baseColourMapUrl = (shape: BaseShape, finish: BaseFinish) =>
  `${IMG}/base-shape/${shape}/${finish.folder}/base_color.webp`;

export const CHAIR_URL = `${IMG}/accessories/aria/model.glb`;
export type ChairColour = 'color1' | 'color2' | 'color3';
export const chairTextureUrls = (colour: ChairColour, part: 'Top' | 'Leg') => {
  const dir = `${IMG}/accessories/aria/${colour}/chair${part}`;
  return {
    map: `${dir}Color.webp`,
    metalnessMap: `${dir}Metalness.webp`,
    normalMap: `${dir}Normal.webp`,
    roughnessMap: `${dir}Roughness.webp`,
  };
};
