# EDEN

An interactive artificial-life and civilization simulation, experienced from inside the world.

**v0.1 — the founding milestone.** One bounded alien valley. Twenty-one autonomous intelligent settlers
(7 Humans, 7 Veyra, 7 Caelari), nine native creature archetypes, and one very important small creature
named **Lumi**. The question this prototype answers:

> *Can a small 3D world full of autonomous individuals feel alive?*

The world does not wait for you. Every inhabitant selects its own goals from needs, personality and
memory — and Creator Mode lets you read exactly **why**.

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

- **LIVE** — inhabit the world as Emerson, third person. Explore, gather glowberries, earn Lumi's trust.
- **OBSERVE** — stand still. Settlers keep exploring, eating, resting and socializing without you.
- **CREATE** — press `Tab`. God camera, entity inspection (needs, personality, current goal and its
  reasoning, memories, relationships, Lumi's trust), the Chronicle, time control, and small
  interventions (time of day, mist, spawned food).

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Camera (click to lock) |
| `Shift` | Sprint |
| `Space` | Jump |
| `E` | Gather glowberries |
| `F` | Offer a glowberry (Lumi decides whether to take it) |
| Left click | Attack |
| Right click | Dodge |
| `Tab` | Toggle Creator Mode |
| `1 / 2 / 3` | Sim speed 1× / 5× / 20× |
| `P` | Pause |
| `Esc` | Help / pause |
| `F3` | Debug overlay |

## Architecture

The non-negotiable rule: **simulation state is fully separated from rendering.**

```
src/sim/      Pure TypeScript simulation. No Three.js, no React.
              World, agents, needs, utility-AI goals + reasons, memories,
              relationships, wildlife, Lumi, chronicle, terrain math,
              deterministic seeded RNG, creator interventions.
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
