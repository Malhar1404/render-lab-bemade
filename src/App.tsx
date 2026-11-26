import { CameraControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Leva, button, useControls } from 'leva';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { MOODS, type Mood } from './config/moods';
import {
  BASE_FINISHES,
  type BaseFinishId,
  type ChairColour,
  SETUPS,
  type SetupId,
  TOP_COLOURS,
  TOP_HALF_SIZE,
  type TopColour,
} from './config/table';
import { setBoxProjectionOn } from './core/boxProjection';
import { setDiffuseRolloff, setTopFinish } from './core/topShade';
import { Chairs } from './scene/Chairs';
import { Effects } from './scene/Effects';
import { Lighting, useProbe } from './scene/Lighting';
import { Room } from './scene/Room';
import { Table } from './scene/Table';

/** Camera views inside the room (it is 8.6 x 6.2 m; the table is at 0). */
const VIEWS = {
  hero: { position: [2.7, 1.55, 2.6], target: [0, 0.55, 0] },
  front: { position: [0, 1.35, 2.95], target: [0, 0.6, 0] },
  window: { position: [-0.4, 1.4, -2.9], target: [0, 0.6, 0] },
  top: { position: [0.01, 3.0, 0.6], target: [0, 0.7, 0] },
  low: { position: [2.2, 0.85, 1.9], target: [0, 0.7, 0] },
} as const;
type ViewId = keyof typeof VIEWS;

const Scene = ({ mood, values }: { mood: Mood; values: Record<string, unknown> }) => {
  const config = MOODS[mood];
  const probe = useProbe(config.probeUrl);
  const v = values as Tuning;
  const setup = SETUPS[v.setup];
  const [hx, hz] = TOP_HALF_SIZE[setup.top];
  const bounds = useMemo(() => new THREE.Box3(new THREE.Vector3(-hx, 0, -hz), new THREE.Vector3(hx, 0.705, hz)), [hx, hz]);
  const baseFinish = (v.baseFinish === 'auto' ? setup.baseFinish : v.baseFinish) as BaseFinishId;

  return (
    <>
      <Room url={config.roomUrl} probe={probe} exposure={v.roomExposure} />
      <Table
        top={setup.top}
        base={setup.base}
        colour={v.topColour}
        baseFinish={baseFinish}
        probe={probe}
        topEnv={v.topEnv}
        baseEnv={v.baseEnv}
      />
      {v.chairs && (
        <Chairs
          count={setup.chairs}
          colour={v.chairColour}
          shape={setup.top}
          bounds={bounds}
          probe={probe}
          envIntensity={v.chairEnv}
        />
      )}
      <Lighting keyIntensity={v.keyLight} softShadow={v.softShadow} contactShadow={v.contactShadow} />
    </>
  );
};

type Tuning = {
  setup: SetupId;
  topColour: TopColour;
  baseFinish: BaseFinishId | 'auto';
  chairColour: ChairColour;
  chairs: boolean;
  roomExposure: number;
  topEnv: number;
  baseEnv: number;
  chairEnv: number;
  keyLight: number;
  softShadow: number;
  contactShadow: number;
  boxProjection: boolean;
  diffuseKnee: number;
  diffuseRoll: number;
  topScale: number;
  veinDepth: number;
  toneExposure: number;
  ao: boolean;
};

const options = <T extends string>(record: Record<T, { label: string }>) =>
  Object.fromEntries(Object.entries<{ label: string }>(record).map(([k, c]) => [c.label, k])) as Record<string, T>;

export const App = () => {
  const [mood, setMood] = useState<Mood>('day');
  const controls = useRef<CameraControls>(null);

  const goTo = (view: ViewId, smooth = true) => {
    const { position: p, target: t } = VIEWS[view];
    controls.current?.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], smooth);
  };

  const values = useControls({
    setup: { options: options(SETUPS), value: 'oblongMoon' as SetupId },
    topColour: { label: 'top', options: options(TOP_COLOURS), value: 'calacatta_lux' as TopColour },
    baseFinish: { label: 'base', options: ['auto', ...Object.keys(BASE_FINISHES)], value: 'auto' },
    chairColour: { label: 'chair', options: ['color1', 'color2', 'color3'], value: 'color1' },
    chairs: true,
    roomExposure: { label: 'room exposure', value: MOODS[mood].roomExposure, min: 0.3, max: 4, step: 0.01 },
    topEnv: { label: 'top env', value: MOODS[mood].tableEnvIntensity, min: 0, max: 6, step: 0.01 },
    baseEnv: { label: 'base env', value: 1.46, min: 0, max: 6, step: 0.01 },
    chairEnv: { label: 'chair env', value: 2, min: 0, max: 6, step: 0.01 },
    keyLight: { label: 'key light', value: 0.8, min: 0, max: 4, step: 0.01 },
    softShadow: { label: 'soft shadow', value: 0.18, min: 0, max: 1, step: 0.01 },
    contactShadow: { label: 'contact shadow', value: 0.55, min: 0, max: 1, step: 0.01 },
    boxProjection: { label: 'box projection', value: true },
    diffuseKnee: { label: 'diffuse knee', value: 0.4, min: 0.1, max: 2, step: 0.01 },
    diffuseRoll: { label: 'diffuse roll', value: 0.9, min: 0, max: 2, step: 0.01 },
    topScale: { label: 'top scale', value: 1.1, min: 0.5, max: 2, step: 0.01 },
    veinDepth: { label: 'vein depth', value: 5, min: 0, max: 10, step: 0.1 },
    toneExposure: { label: 'tone exposure', value: 1.02, min: 0.3, max: 3, step: 0.01 },
    ao: { label: 'AO (N8AO)', value: false },
    'hero view': button(() => goTo('hero')),
    'front view': button(() => goTo('front')),
    'window view': button(() => goTo('window')),
    'top view': button(() => goTo('top')),
    'low view': button(() => goTo('low')),
  }) as unknown as Tuning;

  useEffect(() => setBoxProjectionOn(values.boxProjection), [values.boxProjection]);
  useEffect(() => setDiffuseRolloff(values.diffuseKnee, values.diffuseRoll), [values.diffuseKnee, values.diffuseRoll]);
  useEffect(() => setTopFinish(values.topScale, values.veinDepth), [values.topScale, values.veinDepth]);

  return (
    <>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 30, near: 0.05, far: 50, position: [...VIEWS.hero.position] }}
        gl={{ antialias: false, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: values.toneExposure }}
        onCreated={({ gl }) => (gl.outputColorSpace = THREE.SRGBColorSpace)}
      >
        <ExposureSync exposure={values.toneExposure} />
        <Suspense fallback={null}>
          <Scene mood={mood} values={values} />
        </Suspense>
        <CameraControls
          ref={controls}
          makeDefault
          minDistance={0.6}
          maxDistance={4}
          maxPolarAngle={Math.PI * 0.49}
        />
        <Effects ao={values.ao} />
        <InitialView onReady={() => goTo('hero', false)} />
      </Canvas>
      <div className="moods">
        {(Object.keys(MOODS) as Mood[]).map((m) => (
          <button key={m} className={m === mood ? 'on' : ''} onClick={() => setMood(m)}>
            {MOODS[m].label}
          </button>
        ))}
      </div>
      <Leva collapsed={false} titleBar={{ title: 'Render lab' }} />
    </>
  );
};

/** Tone exposure is a renderer setting: keep it in step with the slider. */
const ExposureSync = ({ exposure }: { exposure: number }) => {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  return null;
};

const InitialView = ({ onReady }: { onReady: () => void }) => {
  useEffect(() => onReady(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
};
