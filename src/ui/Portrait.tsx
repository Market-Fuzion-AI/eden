/**
 * A character portrait.
 *
 * Data in, framed image out. The whole point of this file is that when the
 * high-fidelity anime portraits arrive from the concept-art pipeline, the only
 * thing that changes is `PORTRAIT_ART` below — no dialogue logic, no layout, no
 * panel, nothing that decides *when* a portrait appears or *which* one.
 *
 * A portrait is addressed by three things:
 *   `portraitId` — who. Either a character key (`kai`, `maya`) or a generated
 *     descriptor for the anonymous inhabitants (`settler:human:female`).
 *   `mood` — which expression to draw. The dialogue layer already tags every
 *     line with one.
 *   `side` — which shoulder of the screen they occupy, and therefore which way
 *     the art should face.
 *
 * Until there is art, the placeholder is an initial in a lit frame. It is
 * deliberately the same size and position the real portrait will occupy, so the
 * layout being judged today is the layout that ships.
 */

export type PortraitSide = 'left' | 'right';

/**
 * Where the artwork lives, once it exists.
 *
 * Keyed by portrait id, then by mood, so a character can have as few or as many
 * expressions as the art budget allows — a missing mood falls back to neutral,
 * and a missing character falls back to the placeholder. Nothing here is
 * required for the game to run.
 */
export const PORTRAIT_ART: Record<string, Partial<Record<string, string>>> = {
  // e.g. maya: { neutral: '/portraits/maya-neutral.webp', warm: '...' },
};

/** The art for a given portrait and mood, or null while none exists. */
export function portraitArt(portraitId: string, mood: string): string | null {
  const set = PORTRAIT_ART[portraitId];
  if (!set) return null;
  return set[mood] ?? set.neutral ?? null;
}

/**
 * The initial shown in the placeholder.
 *
 * Strips an honorific first — "Dr. Maya Reyes" should read as M, not D.
 */
function initialFor(name: string): string {
  return name.replace(/^(Dr|Mr|Ms|Mrs)\.?\s*/i, '').charAt(0).toUpperCase();
}

export function Portrait({
  portraitId,
  name,
  mood,
  side,
  speaking,
}: {
  portraitId: string;
  name: string;
  mood: string;
  side: PortraitSide;
  speaking: boolean;
}) {
  const art = portraitArt(portraitId, mood);
  return (
    <div
      className={`portrait-card side-${side} ${speaking ? 'speaking' : 'listening'}`}
      data-portrait={portraitId}
      data-mood={mood}
    >
      <div className="portrait-art">
        {art ? (
          <img src={art} alt="" draggable={false} />
        ) : (
          <div className="portrait-placeholder">{initialFor(name)}</div>
        )}
      </div>
      <div className="portrait-caption">
        <span className="portrait-name">{name}</span>
        <span className="portrait-mood">{mood}</span>
      </div>
    </div>
  );
}
