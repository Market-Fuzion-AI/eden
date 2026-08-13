import { useUI } from '../state/store';
import { Agents } from './Agents';
import { Beams } from './Beams';
import { AgricultureSite } from './AgricultureSite';
import { CampVisuals } from './CampVisuals';
import { CrashSite } from './CrashSite';
import { CreatorRig } from './CreatorRig';
import { EdenEnvironment } from './Environment';
import { LandingSite } from './LandingSite';
import { MistLayer } from './MistLayer';
import { PlayerRig } from './PlayerRig';
import { PulseShots } from './PulseShots';
import { ScannerFX } from './ScannerFX';
import { ResourceNodes } from './ResourceNodes';
import { SocialLinks } from './SocialLinks';
import { StructureVisuals } from './StructureVisuals';
import { SyntheticSite } from './SyntheticSite';
import { TestCourse } from './TestCourse';
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
      <LandingSite />
      <SyntheticSite />
      <CrashSite />
      <AgricultureSite />
      <TestCourse />
      <ResourceNodes />
      <StructureVisuals />
      <MistLayer />
      <Agents />
      <Beams />
      <PulseShots />
      <PlayerRig />
      <ScannerFX />
      {mode === 'creator' && <CreatorRig />}
      {mode === 'creator' && <SocialLinks />}
    </>
  );
}
