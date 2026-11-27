import { EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { Effect, SMAAPreset, ToneMappingMode } from 'postprocessing';
import { useEffect, useMemo } from 'react';
import { Uniform } from 'three';

type Props = { ao: boolean; contrast: number };

/**
 * Contrast round middle grey, on the scene's light before tone mapping:
 * out = 0.18 x (in / 0.18) ^ contrast. A power on the light is a straight
 * contrast in stops, as Blender's AgX looks apply it ("Medium High
 * Contrast" is about 1.2). 1: off.
 */
class ContrastEffect extends Effect {
  constructor(contrast = 1) {
    super(
      'ContrastEffect',
      /* glsl */ `
uniform float contrast;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, vec3(1e-6));
  outputColor = vec4(0.18 * pow(c / 0.18, vec3(contrast)), inputColor.a);
}
`,
      { uniforms: new Map([['contrast', new Uniform(contrast)]]) },
    );
  }
}

const Contrast = ({ value }: { value: number }) => {
  const effect = useMemo(() => new ContrastEffect(), []);
  useEffect(() => {
    effect.uniforms.get('contrast')!.value = value;
  }, [effect, value]);
  useEffect(() => () => effect.dispose(), [effect]);
  return <primitive object={effect} dispose={null} />;
};

/**
 * Post: optional ambient occlusion, contrast, tone mapping, anti-aliasing.
 * AgX (since 2026-11-27), as Blender's renders: it holds a bright window
 * next to a dark corner the way a camera does, where Neutral flattened the
 * room. Blender's previews add the "Medium High Contrast" look on top; the
 * contrast step matches it (without it the lab looked pale and flat).
 */
export const Effects = ({ ao, contrast }: Props) => (
  <EffectComposer multisampling={4}>
    <>{ao && <N8AO aoRadius={0.4} intensity={1.8} distanceFalloff={0.5} quality="high" />}</>
    <Contrast value={contrast} />
    <ToneMapping mode={ToneMappingMode.AGX} />
    <SMAA preset={SMAAPreset.ULTRA} />
  </EffectComposer>
);
