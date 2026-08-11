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
report of what changed while time ran fast. **v0.3** made it consequential —

> *Yesterday changes tomorrow.*

Relationships are now four dimensions (affinity, trust, familiarity, fear) that resolve to a readable
state, and they feed straight back into goal selection. A settler will cross the valley for someone
who once fed them, refuse to approach someone they fear, share scarce food, resent whoever took the
last of it, and confront a standing grievance — or, given the right temperament, make peace instead.
None of it is scripted; it all falls out of needs, personality and recorded history.

**v0.4** turned that into geography —

> *Needs + relationships + resources create place.*

Settlers harvest wood and stone, decide on their own to build a campfire or a shelter, choose a site,
and haul materials to it. Others join the work, more readily for someone they trust. Construction
takes real time and real resources, and a half-supplied site visibly stalls half-built. Finished
shelters get slept in; finished campfires pull people together after dark, and *which* fire someone
walks to depends on who is already sitting at it. Within a week or so, the valley grows two or three
small clusters of buildings that people keep returning to.

**v0.5** gave those places contested meaning —

> *Expectation before law.*

There is no `ownerId` anywhere in EDEN, and there never will be. Instead each settler forms their own
reading of a structure from what they actually did — staked it, hauled for it, slept in it — who else
did, how they feel about those people, and what they personally believe about property. Three settlers
can look at one shelter and see a private room, a joint effort and a common resource, and the
simulation stores all three without deciding between them. They ask each other for permission, grant
it or refuse it, notice intrusions or let them pass, and their expectations harden or soften with what
they live through.

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
  (time of day, mist, spawned food, glowberry yield).

  Click any bond to open the relationship drill-down: the four dimensions, the derived state, the
  recorded history of every change, and exactly how that relationship is steering the settler's
  choices right now. Selecting a settler also draws their social graph in the world, coloured by
  relationship state.

  Click a structure for its full provenance — who staked it and why, who carried which materials,
  how much of the labour each person did, when it was finished, why *there*, and who keeps coming
  back to it. Every line is read from the structure's own record.

  The same panel shows **how each person reads the place**, with the reasoning behind every claim, and
  flags it CONTESTED when they disagree. The left panel tallies each people's shelter expectations —
  descriptive only; it is not law and not culture, just a count of what individuals happen to believe.

Skip ahead at 5× or 20× and drop back to 1×, and the world reports what changed while you were not
watching — population, new relationships, discoveries, budding events, deaths, conflicts. Every figure
is counted from real simulation state; nothing is invented.

Set the glowberry yield to **Low** and watch a society under pressure: settlers begin taking the last
of a patch in front of hungry neighbours, grievances accumulate, and some of them are eventually said
out loud. Others give food away instead. Nothing about that is scripted — scarcity simply changes what
the existing needs, utility and relationship systems decide to do.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrow keys | Move (camera-relative) |
| Mouse | Look around — click the world to enable, `Esc` to release |
| `Shift` | Sprint |
| `Space` | Jump |
| `E` | Gather glowberries or materials · contribute to a build · talk to a settler |
| `F` | Offer a glowberry (Lumi decides whether to take it) |
| `R` | Ask a settler's permission to use their shelter |
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
              structured relationships (affinity/trust/familiarity/fear with
              recorded history), structures and construction with full
              provenance, agent-relative claims and informal norms,
              wildlife, Lumi, chronicle (with structured
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
