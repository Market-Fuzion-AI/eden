# EDEN

An interactive artificial-life and civilization simulation, experienced from inside the world.

One bounded alien valley. Twenty-one autonomous intelligent settlers (7 Humans, 7 Veyra, 7 Caelari),
nine native creature archetypes, and one very important small creature named **Lumi**. The question
this prototype answers:

> *Can a small 3D world full of autonomous individuals feel alive?*

The world does not wait for you. Every inhabitant selects its own goals from needs, personality and
memory — and Creator Mode lets you read exactly **why**.

**v0.1** built the simulation. **v0.2** made it legible: camera-relative movement, conversations you
can hold and conversations you can watch, a Chronicle that explains itself, named places, and a
report of what changed while time ran fast.

## Running it

```bash
npm install
npm run dev        # open http://localhost:5173
```

Other commands:

```bash
npm run build      # typecheck + production build
npm test           # headless simulation tests (autonomy, determinism, bounded state)
npm run preview    # serve the production build
node scripts/smoke.mjs   # browser smoke test with screenshots (needs preview/dev running)
```

## The three experiences

- **LIVE** — inhabit the world as Emerson, third person. Explore, gather glowberries, talk to settlers,
  earn Lumi's trust. ARI names the places you enter and identifies what you look at.
- **OBSERVE** — stand still. Settlers keep exploring, eating, resting and holding conversations you can
  actually watch: they stop, face each other, gesture, and part again.
- **CREATE** — press `Tab`. God camera, entity inspection (needs, personality, current goal and its
  reasoning, memories, relationships, Lumi's trust), a Chronicle where every entry can be clicked to
  fly to the scene and read *why it happened and what changed*, time control, and interventions
  (time of day, mist, spawned food).

Skip ahead at 5× or 20× and drop back to 1×, and the world reports what changed while you were not
watching — population, new relationships, discoveries, budding events, deaths, conflicts. Every figure
is counted from real simulation state; nothing is invented.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrow keys | Move (camera-relative) |
| Mouse | Look around — click the world to enable, `Esc` to release |
| `Shift` | Sprint |
| `Space` | Jump |
| `E` | Gather glowberries · talk to a settler |
| `F` | Offer a glowberry (Lumi decides whether to take it) |
| Left click | Attack |
| Right click | Dodge |
| `Tab` | Toggle Creator Mode |
| `1 / 2 / 3` | Sim speed 1× / 5× / 20× |
| `P` | Pause |
| `Esc` | Release the mouse · help |
| `F3` | Debug overlay (fps, achieved sim rate, seed) |

Mouse-look is *camera control only* — it never means taking control of anyone. Creator Mode always
keeps your cursor.

## Architecture

The non-negotiable rule: **simulation state is fully separated from rendering.**

```
src/sim/      Pure TypeScript simulation. No Three.js, no React.
              World, agents, needs, utility-AI goals + reasons, memories,
              relationships, wildlife, Lumi, chronicle (with structured
              who/where/why/effects payloads), landmarks, deterministic
              dialogue, temporal summaries, terrain math, seeded RNG,
              creator interventions.
src/state/    Thin Zustand store for UI-reactive state (mode, speed,
              selection, ~5 Hz UI pulse). Never per-tick data.
src/game/     Fixed-timestep loop (30 Hz sim steps × speed multiplier)
              and global input.
src/render/   React Three Fiber presentation adapter: procedural toon-shaded
              rigs (visual factories awaiting a future GLTF pipeline),
              terrain/water/flora, third-person + creator cameras.
src/ui/       HUD, ARI feed, Creator panels, inspector, chronicle.
```

Agents keep existing — and deciding — whether or not anything renders them. Sim time is decoupled
from frame rate; entity IDs are stable; events and memories are structured. That is the groundwork
for the eventual macro-simulation (century-scale time jumps), populations, genetics and history —
none of which are built yet, all of which have a place to live.

The world seed is persisted in `localStorage` and shown in Creator Mode; a given seed reproduces the
same valley and the same history.

**Terrain is built once and never mutated.** Its shape is a pure function of position and seed, so the
geography stays fixed unless an explicit world-changing system alters it — verified by test and by the
browser smoke run, which hashes the terrain's vertices before and after a fast-forward. Anything added
to the world after worldgen (a Creator-spawned food patch, for example) records its own provenance:
cause, actor and timestamp.

The fixed-timestep loop spends a wall-clock budget per frame rather than a fixed tick count, so a slow
frame can never silently downgrade a requested 20× into 3×. When the machine genuinely cannot keep up,
the debug overlay (`F3`) says so explicitly.
