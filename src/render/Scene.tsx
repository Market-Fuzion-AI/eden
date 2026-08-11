import { useUI } from '../state/store';
import { Agents } from './Agents';
import { CampVisuals } from './CampVisuals';
import { CreatorRig } from './CreatorRig';
import { EdenEnvironment } from './Environment';
import { MistLayer } from './MistLayer';
import { PlayerRig } from './PlayerRig';
import { ResourceNodes } from './ResourceNodes';
import { SocialLinks } from './SocialLinks';
import { Terrain } from './Terrain';
import { Vegetation } from './Vegetation';
import { Water } from './Water';

export function Scene() {
  const mode = useUI((s) => s.mode);
  return (
    <>
      <EdenEnvironment />
      <Terrain />
      <Water />
      <Vegetation />
      <CampVisuals />
      <ResourceNodes />
      <MistLayer />
      <Agents />
      <PlayerRig />
      {mode === 'creator' && <CreatorRig />}
      {mode === 'creator' && <SocialLinks />}
    </>
  );
}
