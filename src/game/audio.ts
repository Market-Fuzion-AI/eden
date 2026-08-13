/**
 * Combat audio.
 *
 * Every sound in EDEN is synthesised in the browser from oscillators and
 * generated noise. There are no audio files in the repository and nothing is
 * fetched at runtime: no licensing surface, no download cost, and the whole
 * palette is a few hundred lines of arithmetic that can be tuned like any other
 * constant.
 *
 * The rule this module follows is that audio is *feedback*, never atmosphere.
 * It fires on discrete events the player caused or must react to — a swing, a
 * connect, a wind-up starting — and it stays silent the rest of the time.
 *
 * It is also strictly optional. Browsers refuse to start an AudioContext until
 * the user has interacted with the page, so every entry point here degrades to
 * doing nothing rather than throwing. Audio must never be able to break the
 * game.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
/** Shared noise buffer — generating it once is much cheaper than per-shot. */
let noiseBuffer: AudioBuffer | null = null;

const STORAGE_KEY = 'eden.audio';

export function audioEnabled(): boolean {
  return enabled;
}

export function setAudioEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode — the preference simply does not persist */
  }
  if (master) master.gain.value = on ? 0.32 : 0;
}

/**
 * Create or resume the context. Safe to call on every input event: browsers
 * only allow the context to start inside a user gesture, and calling this from
 * one is exactly how it gets unblocked.
 */
export function primeAudio(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'off') enabled = false;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.32 : 0;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function ready(): boolean {
  return Boolean(ctx && master && enabled && ctx.state === 'running');
}

function noise(): AudioBuffer | null {
  if (!ctx) return null;
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 0.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Deterministic, so the noise floor is identical run to run.
  let seed = 0x9e3779b9;
  for (let i = 0; i < len; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  noiseBuffer = buf;
  return buf;
}

interface ToneOpts {
  type?: OscillatorType;
  from: number;
  to?: number;
  duration: number;
  gain?: number;
  delay?: number;
  /** Optional band-pass, for giving a tone a body rather than a beep. */
  filter?: { type: BiquadFilterType; freq: number; q?: number };
}

/** A single pitched element. */
function tone(o: ToneOpts): void {
  if (!ready()) return;
  const c = ctx!;
  const t0 = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.from, t0);
  if (o.to !== undefined && o.to !== o.from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.duration);
  }
  const g = c.createGain();
  const peak = o.gain ?? 0.3;
  // A tiny attack rather than an instant one: a hard edge on a gain node is
  // audible as a click, and a click on every sword swing is unbearable.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.duration);

  let tail: AudioNode = osc;
  if (o.filter) {
    const f = c.createBiquadFilter();
    f.type = o.filter.type;
    f.frequency.value = o.filter.freq;
    f.Q.value = o.filter.q ?? 1;
    osc.connect(f);
    tail = f;
  }
  tail.connect(g);
  g.connect(master!);
  osc.start(t0);
  osc.stop(t0 + o.duration + 0.02);
}

/** A burst of filtered noise — impacts, sweeps, discharges. */
function hiss(opts: {
  duration: number;
  gain?: number;
  delay?: number;
  freq: number;
  toFreq?: number;
  type?: BiquadFilterType;
  q?: number;
}): void {
  if (!ready()) return;
  const c = ctx!;
  const buf = noise();
  if (!buf) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = opts.type ?? 'bandpass';
  f.frequency.setValueAtTime(opts.freq, t0);
  if (opts.toFreq !== undefined) {
    f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.toFreq), t0 + opts.duration);
  }
  f.Q.value = opts.q ?? 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.25, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);
  src.connect(f);
  f.connect(g);
  g.connect(master!);
  src.start(t0);
  src.stop(t0 + opts.duration + 0.02);
}

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

/** The blade coming out: a rising charge with a hard snap on the end. */
export function sfxBladeDeploy(): void {
  tone({ type: 'sawtooth', from: 180, to: 760, duration: 0.26, gain: 0.16, filter: { type: 'lowpass', freq: 2400 } });
  tone({ type: 'sine', from: 1180, to: 1560, duration: 0.18, gain: 0.1, delay: 0.16 });
  hiss({ duration: 0.2, freq: 2600, toFreq: 5200, gain: 0.09, delay: 0.1 });
}

/**
 * A swing. Pitched by chain step so the three light attacks are audibly a
 * sequence, and the heavy is unmistakably heavier.
 */
export function sfxSwing(kind: 'light' | 'heavy', chain = 1): void {
  if (kind === 'heavy') {
    hiss({ duration: 0.3, freq: 900, toFreq: 220, gain: 0.2, q: 0.9 });
    tone({ type: 'triangle', from: 190, to: 82, duration: 0.32, gain: 0.16 });
    return;
  }
  const base = [1500, 1750, 1250][Math.min(2, Math.max(0, chain - 1))];
  hiss({ duration: 0.16, freq: base, toFreq: base * 0.35, gain: 0.13, q: 1.1 });
  tone({ type: 'triangle', from: base * 0.42, to: base * 0.2, duration: 0.14, gain: 0.07 });
}

/** Connecting. Biological is a wet thud; synthetic is a metallic ring. */
export function sfxHit(synthetic: boolean, heavy: boolean): void {
  if (synthetic) {
    tone({ type: 'square', from: heavy ? 420 : 620, to: heavy ? 150 : 260, duration: 0.16, gain: 0.16, filter: { type: 'bandpass', freq: 1500, q: 3 } });
    hiss({ duration: 0.14, freq: 4200, toFreq: 1400, gain: 0.13 });
    return;
  }
  tone({ type: 'sine', from: heavy ? 150 : 220, to: 60, duration: heavy ? 0.2 : 0.13, gain: 0.22 });
  hiss({ duration: 0.1, freq: 700, toFreq: 200, gain: 0.14, q: 0.8 });
}

/** A creature rocked out of its stance. The reward sound. */
export function sfxStagger(): void {
  tone({ type: 'sine', from: 320, to: 90, duration: 0.34, gain: 0.24 });
  hiss({ duration: 0.26, freq: 1500, toFreq: 260, gain: 0.16, q: 0.7 });
}

/** The roll. Deliberately soft — it happens a lot. */
export function sfxDodge(): void {
  hiss({ duration: 0.22, freq: 380, toFreq: 1500, gain: 0.1, q: 0.7 });
}

/** A predator's warning. Low, rising, and it should make the player stop. */
export function sfxRakhorWarn(): void {
  tone({ type: 'sawtooth', from: 90, to: 148, duration: 0.85, gain: 0.13, filter: { type: 'lowpass', freq: 900, q: 2 } });
  tone({ type: 'sawtooth', from: 61, to: 96, duration: 0.9, gain: 0.1, filter: { type: 'lowpass', freq: 500 } });
}

/** The lunge. */
export function sfxRakhorLunge(): void {
  tone({ type: 'sawtooth', from: 260, to: 120, duration: 0.3, gain: 0.2, filter: { type: 'lowpass', freq: 1600 } });
  hiss({ duration: 0.22, freq: 900, toFreq: 300, gain: 0.15 });
}

/** The Warden spinning up. A rising machine whine — the clearest tell we have. */
export function sfxWardenCharge(): void {
  tone({ type: 'sawtooth', from: 220, to: 1320, duration: 1.3, gain: 0.12, filter: { type: 'bandpass', freq: 1600, q: 4 } });
  tone({ type: 'square', from: 110, to: 660, duration: 1.3, gain: 0.06, filter: { type: 'lowpass', freq: 1200 } });
}

/** The beam firing. */
export function sfxWardenBeam(): void {
  hiss({ duration: 0.34, freq: 5200, toFreq: 900, gain: 0.24, q: 0.8 });
  tone({ type: 'sawtooth', from: 900, to: 180, duration: 0.34, gain: 0.16, filter: { type: 'lowpass', freq: 3000 } });
}

/** The close-range shove. */
export function sfxWardenBurst(): void {
  tone({ type: 'sine', from: 420, to: 60, duration: 0.4, gain: 0.28 });
  hiss({ duration: 0.3, freq: 2200, toFreq: 200, gain: 0.2, q: 0.6 });
}

/** Kai taking a hit. */
export function sfxPlayerHurt(): void {
  tone({ type: 'triangle', from: 300, to: 92, duration: 0.28, gain: 0.24, filter: { type: 'lowpass', freq: 1100 } });
  hiss({ duration: 0.16, freq: 520, toFreq: 150, gain: 0.16, q: 0.7 });
}

/** Salvage recovered. The one unambiguously good sound in the set. */
export function sfxSalvage(): void {
  tone({ type: 'sine', from: 880, to: 1320, duration: 0.2, gain: 0.16 });
  tone({ type: 'sine', from: 1320, to: 1760, duration: 0.26, gain: 0.13, delay: 0.13 });
}

/** Something died. Short, and not triumphant. */
export function sfxDefeat(synthetic: boolean): void {
  if (synthetic) {
    tone({ type: 'sawtooth', from: 700, to: 60, duration: 0.75, gain: 0.2, filter: { type: 'lowpass', freq: 1800 } });
    hiss({ duration: 0.6, freq: 3000, toFreq: 120, gain: 0.15 });
    return;
  }
  tone({ type: 'sine', from: 240, to: 70, duration: 0.6, gain: 0.2 });
}

/** The extraction beacon. */
export function sfxExtraction(): void {
  tone({ type: 'sine', from: 520, to: 520, duration: 0.18, gain: 0.18 });
  tone({ type: 'sine', from: 392, to: 392, duration: 0.18, gain: 0.18, delay: 0.22 });
  tone({ type: 'sine', from: 262, to: 262, duration: 0.5, gain: 0.18, delay: 0.44 });
}
