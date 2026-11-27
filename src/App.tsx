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
import { setPlanarStrength } from './core/planarReflection';
import { setDiffuseRolloff, setTopFinish } from './core/topShade';
import { newEntryId, saveEntry, timeString, todayString, uploadImage } from './devlog/api';
import { Chairs } from './scene/Chairs';
import { Effects } from './scene/Effects';
import { Lighting, useProbe } from './scene/Lighting';
import { Garden } from './scene/Garden';
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

const ROOM_INSIDE = new THREE.Box3(new THREE.Vector3(-4.1, 0.2, -2.9), new THREE.Vector3(4.1, 3.0, 2.9));

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
      <Garden intensity={config.garden} />
      <Room
        url={config.roomUrl}
        probe={probe}
        exposure={v.roomExposure}
        lightScale={config.lightScale}
        rgbm={config.rgbm}
      />
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
      <Lighting
        sun={v.sun}
        chandelier={v.chandelier}
        lamp={v.lamp}
        floorShadow={v.floorShadow}
        floorLight={config.floorLight}
        shadowSoftness={config.shadowSoftness}
        softShadow={v.softShadow}
        contactShadow={v.contactShadow}
      />
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
  sun: number;
  chandelier: number;
  lamp: number;
  floorShadow: number;
  softShadow: number;
  contactShadow: number;
  boxProjection: boolean;
  diffuseKnee: number;
  diffuseRoll: number;
  topScale: number;
  veinDepth: number;
  toneExposure: number;
  ao: boolean;
  contrast: number;
  reflection: number;
};

const options = <T extends string>(record: Record<T, { label: string }>) =>
  Object.fromEntries(Object.entries<{ label: string }>(record).map(([k, c]) => [c.label, k])) as Record<string, T>;

export const App = () => {
  const [mood, setMood] = useState<Mood>('day');
  const controls = useRef<CameraControls>(null);
  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  // The latest mood and slider values, for the snapshot button (leva builds its buttons once).
  const latest = useRef<{ mood: Mood; values: Tuning | null }>({ mood, values: null });
  const [toast, setToast] = useState('');

  const goTo = (view: ViewId, smooth = true) => {
    const { position: p, target: t } = VIEWS[view];
    controls.current?.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], smooth);
  };

  /** Dev only: log the canvas, the camera and the slider values to the dev log. */
  const logSnapshot = async () => {
    const canvas = canvasEl.current;
    const { mood: m, values: v } = latest.current;
    if (!canvas || !v) return;
    try {
      // Grab the picture first: the prompts below stop the render loop.
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The canvas could not be read');
      const title = window.prompt('Snapshot title', `Lab snapshot, ${MOODS[m].label.toLowerCase()}`);
      if (title === null) return;
      const note = window.prompt('Note: what are you looking at or checking?', '');
      if (note === null) return;
      const round = (n: number) => Math.round(n * 1000) / 1000;
      const position = controls.current?.getPosition(new THREE.Vector3()).toArray().map(round);
      const target = controls.current?.getTarget(new THREE.Vector3()).toArray().map(round);
      const name = title.trim() || `Lab snapshot, ${MOODS[m].label.toLowerCase()}`;
      const date = todayString();
      const id = await newEntryId(date, name);
      const file = await uploadImage(id, blob, 'snapshot.png');
      await saveEntry({
        id,
        date,
        time: timeString(),
        title: name,
        area: 'viewer',
        outcome: 'open',
        author: 'user',
        what: note.trim() || name,
        why: 'Snapshot from the lab',
        how: 'Snapshot from the lab',
        tags: ['snapshot', m],
        images: [{ file, kind: 'capture', caption: name }],
        meta: { mood: m, camera: { position, target }, sliders: v },
      });
      setToast(`Logged to the dev log: ${id}`);
    } catch (err) {
      setToast(`Dev log failed: ${err instanceof Error ? err.message : String(err)} (is npm run dev running?)`);
    }
  };

  // Function form: the setter lets a mood switch reset its sliders.
  const [values, setControls] = useControls(() => ({
    setup: { options: options(SETUPS), value: 'oblongMoon' as SetupId },
    topColour: { label: 'top', options: options(TOP_COLOURS), value: 'calacatta_lux' as TopColour },
    baseFinish: { label: 'base', options: ['auto', ...Object.keys(BASE_FINISHES)], value: 'auto' },
    chairColour: { label: 'chair', options: ['color1', 'color2', 'color3'], value: 'color1' },
    chairs: true,
    roomExposure: { label: 'room exposure', value: MOODS[mood].roomExposure, min: 0.3, max: 4, step: 0.01 },
    topEnv: { label: 'top env', value: MOODS[mood].tableEnvIntensity, min: 0, max: 6, step: 0.01 },
    baseEnv: { label: 'base env', value: 1.46, min: 0, max: 6, step: 0.01 },
    chairEnv: { label: 'chair env', value: 2, min: 0, max: 6, step: 0.01 },
    sun: { label: 'sun', value: MOODS[mood].lights.sun, min: 0, max: 20, step: 0.1 },
    chandelier: { label: 'chandelier', value: MOODS[mood].lights.chandelier, min: 0, max: 30, step: 0.1 },
    lamp: { label: 'floor lamp', value: MOODS[mood].lights.lamp, min: 0, max: 20, step: 0.1 },
    floorShadow: { label: 'floor shadow', value: 1, min: 0, max: 1, step: 0.01 },
    softShadow: { label: 'soft shadow', value: 0.18, min: 0, max: 1, step: 0.01 },
    contactShadow: { label: 'contact shadow', value: 0.55, min: 0, max: 1, step: 0.01 },
    boxProjection: { label: 'box projection', value: true },
    reflection: { label: 'top mirror', value: 1, min: 0, max: 2, step: 0.01 },
    diffuseKnee: { label: 'diffuse knee', value: 0.4, min: 0.1, max: 2, step: 0.01 },
    diffuseRoll: { label: 'diffuse roll', value: 0.9, min: 0, max: 2, step: 0.01 },
    topScale: { label: 'top scale', value: 1.1, min: 0.5, max: 2, step: 0.01 },
    veinDepth: { label: 'vein depth', value: 5, min: 0, max: 10, step: 0.1 },
    toneExposure: { label: 'tone exposure', value: 1.02, min: 0.3, max: 3, step: 0.01 },
    // On (2026-11-27): darkens where the table and chairs meet the rug and
    // each other; the room's own corners are already in its bake.
    ao: { label: 'AO (N8AO)', value: true },
    // Blender's AgX "Medium High Contrast" look is about 1.2 (Effects.tsx).
    contrast: { label: 'contrast', value: 1.2, min: 0.8, max: 1.6, step: 0.01 },
    'hero view': button(() => goTo('hero')),
    'front view': button(() => goTo('front')),
    'window view': button(() => goTo('window')),
    'top view': button(() => goTo('top')),
    'low view': button(() => goTo('low')),
    // The dev log API only exists in the dev server.
    ...(import.meta.env.DEV ? { '📸 log snapshot': button(() => void logSnapshot()) } : {}),
  })) as unknown as [Tuning, (v: Partial<Tuning>) => void];

  latest.current = { mood, values };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Each mood starts from its own room and table brightness.
  useEffect(() => {
    setControls({
      roomExposure: MOODS[mood].roomExposure,
      topEnv: MOODS[mood].tableEnvIntensity,
      ...MOODS[mood].lights,
    });
  }, [mood, setControls]);

  useEffect(() => setBoxProjectionOn(values.boxProjection), [values.boxProjection]);
  useEffect(() => setPlanarStrength(values.reflection), [values.reflection]);
  useEffect(() => setDiffuseRolloff(values.diffuseKnee, values.diffuseRoll), [values.diffuseKnee, values.diffuseRoll]);
  useEffect(() => setTopFinish(values.topScale, values.veinDepth), [values.topScale, values.veinDepth]);

  return (
    <>
      <Canvas
        shadows
        // At least 1.5x the screen's pixels, shrunk to fit: smooths the edges
        // (with the composer's 4x multisampling and SMAA). Capped at 2.
        dpr={[1.5, 2]}
        // 40 degrees (was 30): more of the room in view from inside it.
        camera={{ fov: 40, near: 0.05, far: 50, position: [...VIEWS.hero.position] }}
        // preserveDrawingBuffer lets the snapshot button read the canvas.
        gl={{
          antialias: false,
          preserveDrawingBuffer: true,
          toneMapping: THREE.AgXToneMapping,
          toneMappingExposure: values.toneExposure,
        }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          canvasEl.current = gl.domElement;
        }}
      >
        <ExposureSync exposure={values.toneExposure} />
        <Suspense fallback={null}>
          <Scene mood={mood} values={values} />
        </Suspense>
        <CameraControls
          ref={controls}
          makeDefault
          minDistance={0.6}
          maxDistance={6}
          maxPolarAngle={Math.PI * 0.49}
          // Zooming out stops at the walls: the camera stays inside the room.
          boundaryEnclosesCamera
        />
        <Effects ao={values.ao} contrast={values.contrast} />
        <InitialView
          onReady={() => {
            // The room's inside, less 20 cm, as the camera's limit (set here:
            // the controls exist only once the canvas has mounted).
            controls.current?.setBoundary(ROOM_INSIDE);
            goTo('hero', false);
          }}
        />
      </Canvas>
      <div className="moods">
        {(Object.keys(MOODS) as Mood[]).map((m) => (
          <button key={m} className={m === mood ? 'on' : ''} onClick={() => setMood(m)}>
            {MOODS[m].label}
          </button>
        ))}
        {import.meta.env.DEV && (
          <a className="devlog-link" href="/devlog.html" target="_blank" rel="noreferrer">
            Dev log
          </a>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
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
