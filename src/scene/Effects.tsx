import { EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

type Props = { ao: boolean };

/** Post: optional ambient occlusion, then the configurator's chain. */
export const Effects = ({ ao }: Props) => (
  <EffectComposer multisampling={4}>
    <>{ao && <N8AO aoRadius={0.4} intensity={1.5} distanceFalloff={0.5} quality="high" />}</>
    <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    <SMAA />
  </EffectComposer>
);
