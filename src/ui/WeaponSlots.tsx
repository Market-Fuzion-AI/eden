import { getWorld } from '../sim';
import { availableWeapons } from '../sim/blaster';
import { useUI } from '../state/store';

/**
 * The two weapon slots.
 *
 * Replaces two lines of text — "1 · Arc Blade" and "2 · Pulse Blaster" — that
 * differed only by a word, so telling which was equipped meant reading both
 * carefully in the middle of a fight. Now the active slot is a lit panel with a
 * bright glyph and the inactive one is dim: which weapon is in Kai's hands is a
 * question answered by glance, not by reading.
 *
 * The glyphs are drawn in CSS and SVG rather than imported as art. This is a
 * UX pass, and a silhouette that reads at 32 pixels is worth more here than a
 * dependency on an icon set.
 */
const SLOT_KEY: Record<string, string> = { arcBlade: '1', pulseBlaster: '2' };
const SLOT_NAME: Record<string, string> = { arcBlade: 'Arc Blade', pulseBlaster: 'Pulse Blaster' };

function WeaponGlyph({ weapon }: { weapon: string }) {
  if (weapon === 'pulseBlaster') {
    return (
      <svg viewBox="0 0 24 24" className="slot-glyph" aria-hidden="true">
        <path d="M3 9h11l3 3-3 3H7l-2-3H3z" fill="currentColor" opacity="0.9" />
        <path d="M17 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 15v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="slot-glyph" aria-hidden="true">
      <path d="M12 2l3 12-3 3-3-3z" fill="currentColor" opacity="0.9" />
      <path d="M8 17h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 20v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function WeaponSlots() {
  useUI((s) => s.uiPulse);
  const world = getWorld();
  const p = world.player;
  const weapons = availableWeapons(world);
  // Nothing to choose between is nothing worth showing.
  if (weapons.length < 2) return null;

  return (
    <div className="weapon-slots">
      {weapons.map((w) => (
        <div key={w} className={`slot ${p.equipped === w ? 'active' : ''}`}>
          <span className="slot-key">{SLOT_KEY[w] ?? '·'}</span>
          <WeaponGlyph weapon={w} />
          <span className="slot-name">{SLOT_NAME[w] ?? w}</span>
        </div>
      ))}
    </div>
  );
}
