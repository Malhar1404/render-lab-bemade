# BeMade Render Lab: project context

Read this first in a new chat. It records what was decided and built, how
the pieces fit together, and what comes next. Last updated 2026-11-26.

## Goal

Photo-real rendering in the BeMade web table configurator. The target is a
set of AI-generated reference images: a daylight dining room with a glass
wall onto a garden, an oak floor, a wool rug, a smoked-walnut credenza with a
marble top, a glass-globe chandelier and a fiddle-leaf fig.

### Constraints (from the user)

- Web configurator only, built for a desktop PC with a GPU first.
- No separate render server.
- One room only.
- Realism must come from physically rendered pixels: no AI enhancement.
- We build the assets ourselves.
- Production quality.

### Agreed approach

A hybrid:

- A fast raster view (three.js) while the user interacts.
- A path tracer (three-gpu-pathtracer, later) refines to photo quality over
  1–3 s when the view is idle.
- The room's light is baked in Blender Cycles into lightmaps plus a 360°
  probe. The table and chairs are lit live from that probe.

## Why this separate app

`render-lab` (this folder, its own git repo) is a clean, minimal test app
that ports the configurator's table look. It is used to work on lighting and
rendering without the configurator's UI. The configurator is
`M:\projects\BeMade\demo-bemade` (branch `m-dev-2`); its room work is
committed there as `9c13b69` and `76a0d0b`.

### Versions

The lab uses the same versions as the configurator, so code ports back:

- three 0.176.0
- @react-three/fiber 8.18.0, drei 9.122.0
- @react-three/postprocessing 2.19.1, postprocessing 6.37.8
- leva 0.10.0, n8ao 1.10.1
- Vite 5.4.11, React 18.3.1, TypeScript 5.6.3

We decided **not** to downgrade three.js: box projection works in r176 (see
`src/core/boxProjection.ts`), and three-gpu-pathtracer needs a recent three.

### Running it

- `npm run dev` starts the app at http://127.0.0.1:5180.
- `npm run typecheck` checks types.

## How the user likes to work

- **Ask first** when anything is unclear ("any questions then ask first").
- **The user checks visuals themselves.** Don't take browser screenshots
  (REA) unless truly needed.
- **Blender:** build live in the user's open Blender through the Blender MCP
  (`execute_blender_code`, `look`) so they can watch. Only baking runs
  headless. Run headless Blender jobs in the background.
  - The workflow is "script, run live": changes go into
    `pipeline/room/build_room.py`, which then runs in the open Blender.
  - Save `.blend` files in the pipeline folder (`pipeline/room/out/`).
- **Commits:** only when the user asks.

## The room pipeline (`pipeline/room/`)

Run the steps in this order:

1. **`fetch_assets.py`** downloads the Poly Haven textures and HDRI.
2. **`prepare_env.py`** prepares the garden sky (`suburban_garden` 8k) with
   the sun removed. It writes `out/env/garden_{8k,4k,2k,1k}.hdr` and
   `env.json`.
3. **`prepare_textures.py`** grades the textures (oak, paint, walnut, linen,
   marble and others). It also generates:
   - the loomed rug: a seamless 2048 px tile covering 1 m;
   - the rug fuzz;
   - the fig leaf colour and normal maps.
4. **`build_room.py`** builds the room. It writes `out/room.blend` and
   `out/room_unbaked.glb`.
   - Room size: `RX, RY, H = 4.3, 3.1, 3.2` (half-length, half-width,
     height), which gives three.js bounds of x ±4.3, z ±3.1 and height 3.2.
   - Glass wall from x −3.9 to 2.4.
   - Rug half-size 2.5 × 1.75.
   - Contents: the credenza matching the reference (smoked walnut;
     door / two stacked drawers / door; marble top with lips; black sled
     legs; decor), the art, the chandelier, plants and fig, the floor lamp
     and the curtains.
   - Lighting (morning): sun at 30° elevation, `garden_4k` world, a
     `table_fill` area light (hidden from camera), and bulb point lights.
   - `reset_scene()` is safe in a live session. **Never call
     `read_factory_settings` live**: it kills the MCP connection.
   - The **Preview** collection (stand-in table and chairs, `view_cam`) is
     kept out of the bake.
5. **`bake_room.py`** (headless, through `run_bake.sh`) does a Cycles DIFFUSE
   bake, direct plus indirect, with no colour.
   - One lightmap per group, on a second UV layer called `lightmap` (smart
     project, packed, then stretched to fill the map). The rug uses planar
     UVs.
   - Group map sizes: 2048 for the floor, each wall, the ceiling, the rug
     and the credenza; 1024 for the curtains, art, terrace, plants and fig;
     512 for the window and lamp.
   - Renders the probe: a 2048×1024 equirect from (0, 0, 0.85).
   - Saves `room_baked.blend`.
6. **`post_bake.py`** writes `out/bake/lm_*.jpg` and
   `public/env/room_2k.hdr`.
   - Denoises lightly.
   - `LIGHT_SCALE = 4`.
   - `NEUTRALIZE = 0.7`: removes 70% of the probe's colour cast.
7. **`export_room.py`** wires each lightmap into the glTF emissive slot on
   `TEXCOORD_1` and writes `out/room_v2_raw.glb`.
8. **`optimize_room.sh`** runs gltf-transform 4.5.1 (resize to 2048, WebP
   quality 88, meshopt) and writes `public/assets/room/room_v2.glb`.

Other tools:

- **`preview_room.py`** makes Cycles previews (moods, cameras a/b/c/r).
- **`post_grade.py`** and **`probe_models.py`** are helpers.

### Conventions and gotchas

- **Lightmap encoding:** the emissive slot holds light / 4 as an sRGB JPEG.
  The viewer sets `lightMapIntensity = 4π × exposure`. Day exposure is 1.46.
- **Equirect probe orientation:** u = 0.5 is +X. Blender +Y is three.js −Z,
  which is u = 0.25. The probe camera's rotation is (90°, 0, −90°).
- **Glass:**
  - Windows are thin alpha glass. Refractive glass blocks the sun and sky
    in Cycles (caustics) and leaves the room black.
  - Chandelier globes are thin-shell transmission with `visible_shadow` off,
    lit by point lights inside.
- **Headless Blender (Microsoft Store build):** run it as
  `/c/Users/malha/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe -b … -P script -- args`.
  - Its stdout is lost, so scripts write log files.
  - Pass Windows paths (`pwd -W`), never `/m/...` paths.
  - Environment variables don't reach the scripts: pass settings as script
    arguments.
  - `run_bake.sh` stops at the first failure.
- **Blender MCP addon:** it is old (protocol 11). `execute_blender_code`
  works; Sketchfab search does not (the fig was built procedurally).
- **Bash heredocs:** nested quoting breaks them. Write Python patch files to
  the scratchpad and run them instead.

## The app (`src/`)

| File | Role |
| --- | --- |
| `main.tsx` | Sets the box projection (room box plus probe position) and `setChandelierStrength(0)`. |
| `App.tsx` | Canvas (fov 30, Neutral tone mapping, shadows) and camera controls. Leva panel: setup, top colour, base finish, chair colour, room exposure, top/base/chair env strengths, key light, shadow opacities, box projection on/off, diffuse knee/roll, top scale, vein depth, tone exposure, AO. Five camera views: hero, front, window, top, low. Day/Evening buttons. |
| `config/moods.ts` | The `day` and `evening` moods (room GLB, probe, exposure, table env), `ROOM_BOX` (centre [0,1.6,0], size [8.6,3.2,6.2]) and `PROBE_POSITION` [0,0.85,0]. **Evening still points at the day files.** |
| `config/table.ts` | Three setups: Oblong + Moon, Capsule + Linea, Round + Linea Dome, at native size. Top colours: Calacatta Lux (polished, brightness 0.94), Calacatta Black (matte), Noce (silk). Base finishes and chair textures, all ported from the configurator. |
| `core/boxProjection.ts` | Parallax-corrected probe. Chains onto any existing `onBeforeCompile`, so it keeps the configurator's patches. The probe position can differ from the box centre. A shared uniform turns it on or off. |
| `core/topShade.ts`, `core/chandelierLight.ts` | Copied unchanged from the configurator: diffuse roll-off, top vein curve, decor reflection, base contact shade. |
| `scene/Room.tsx` | Loads the baked room. Most materials become `MeshBasicMaterial` with the lightmap. The glossy parts (`black_metal`, `credenza_brass/marble/walnut`, `floor_oak`, `window_frame`) become Standard materials that show reflections only, box-projected. The chandelier hides within 40° of looking straight down. |
| `scene/Table.tsx` | Top: `MeshPhysicalMaterial` with clearcoat 1 and clearcoat roughness 0.03. MDF board and base: configurator materials. `applyTableShading` plus box projection on all of them. `updateTopShade` every frame. Each material gets its own env strength. |
| `scene/Chairs.tsx` | Aria chairs placed by the configurator's formula: rectangular tops get one at each end and the rest along the long sides; round tops get them spaced evenly around. |
| `scene/Lighting.tsx` | `useProbe` (RGBE loader). The key light (#fff5e6, 0.8, at [0.4, 3.5, 1.2]). Two ContactShadows (soft 0.18, contact 0.55). |
| `scene/Effects.tsx` | Optional N8AO, then Neutral tone mapping, then SMAA. |

### Key finding: table brightness

In three r176, when a material has no `envMap` of its own and the scene has
an environment, `scene.environmentIntensity` **overrides** the material's
`envMapIntensity`. In the configurator, the bases' 0.2 was therefore ignored,
and the table had one shared brightness of 1.46, equal to the room. The lab
instead sets `envMap = probe` on each material, so every part has its own
strength. Starting values:

- top 2.2
- base 1.46
- chairs 2.0

## Status (2026-11-26)

Done:

- Room built and baked (morning light).
- Rug, credenza and the walls beside the glass wall fixed.
- Lab app written. It typechecks and builds. Runtime shader compilation is
  not yet confirmed in a browser.

Not done: the lab has no git commit yet.

### Waiting on the user

1. Confirm the table renders, with no shader errors.
2. Tune the **top env** and **top scale** sliders, then give the values to
   make the defaults.
3. Compare box projection off and on.
4. Check whether the tone exposure slider does anything. postprocessing's
   ToneMapping effect may ignore `gl.toneMappingExposure`; if it does,
   replace the slider.

## Next steps, in the agreed order

1. ~~Quick fixes: table brightness and box-projected probe.~~ Built in the
   lab; awaiting the user's tuning.
2. **Evening mood, built live in the user's Blender:**
   - a low golden sun at about 5° and a dimmer sky;
   - chandelier on;
   - floor lamp;
   - a **picture light** over the art;
   - an **LED cove**.

   Then render Cycles comparisons of day and evening.
3. **Bake the evening set:** `public/assets/room/room_evening.glb` and
   `public/env/room_evening_2k.hdr`.
   - Update `MOODS.evening`.
   - The Day/Evening toggle already exists.
   - Evening needs the chandelier's light on the table; see
     `chandelierLight.ts`, or add a point light.
   - The leva sliders keep their values when the mood changes; set them from
     the mood instead.
4. **Planar reflection on the tabletop** (option A), blurred by finish:
   sharp for polished, soft for silk, none for matte. It may build on
   topShade's decor reflection uniforms.
5. **Later:** a path-tracer prototype (three-gpu-pathtracer, with the
   oidn-web denoiser) that refines when the view is idle.
6. **Afterwards:** port the results back into `demo-bemade`. Its own `Room.tsx`
   and `Env.tsx` are in `src/components/Viewer3D/SceneSetup/`.

## Organisation rules

- This account is for HexaCoder Technologies work only.
- Never ask for or repeat secrets.
- Client-facing text should be professional and concise, and should name the
  company "HexaCoder Technologies".
