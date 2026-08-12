# EDEN

A third-person sci-fi fantasy action RPG set on a newly colonised world in the far future.

You are **Emerson**, pathfinder for the human colony — not its ruler. You explore an alien valley,
survey it, gather from it, meet the two other intelligent peoples who came down here with you, and
help decide what this place becomes.

The differentiator is underneath:

> *The world continues to think and act without you.*

Twenty-two autonomous settlers (8 Humans, 7 Veyra, 7 Caelari), ten creature archetypes — nine native,
one that is not native to anywhere anybody can name — and
one very important small creature named **Lumi**. Every inhabitant selects its own goals from needs,
personality, memory and what it believes about everyone else. They build, argue, share food, form
expectations and change their minds whether or not you are watching. Creator Mode lets you read
exactly **why** — but you never have to open it.

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

**v0.6** let those expectations travel between people —

> *Private expectation becomes social knowledge becomes informal custom.*

Settlers now hold beliefs about **each other's** expectations: *"I think Sareth treats that shelter as
hers."* They learn by being there — you only find out what someone expects if you were close enough to
watch them refuse, grant, object, or visibly let something pass — and occasionally by being told, when
a conversation happens to turn to somebody else's business. Every belief remembers where it came from,
how sure its holder is, and how long it has been since anything confirmed it.

None of it is authoritative. There is no `structure.norm`, no settlement consensus, no world-level
custom, and there never will be. Beliefs are stored on the person who holds them, and the simulation
never reconciles them against the truth, so a settler can be confidently wrong: about a third of the
mistakes people hold are the kind that actually change what they do. Knowledge goes stale because
nobody announces a change of heart. Hearsay arrives visibly weaker than what you saw yourself. And a
settler who has learned nothing simply assumes everyone feels the way they do — which is how most
misunderstandings start.

Watch it long enough and individuals begin to generalize: *"people around Human Landing usually ask
before using someone else's shelter."* That takes several sightings, weakens when the evidence turns
against it, and stays that person's opinion — two settlers in the same clearing can hold opposite ones.
It is enough to change behaviour at a shelter they have never touched, belonging to someone they know
nothing about. How much it sways them depends on how much they defer to local habit at all; the
independent-minded are not rebellious, just unmoved.

**v0.7A** turned all of that into somewhere worth walking around —

> *Make being Emerson feel good.*

The valley is now three readable regions inside one connected map. The **Human Riverlands** are low,
green and threaded by a river that widens into a lake; the **Veyra Ashlands** are dry rust-coloured
mesa and cut canyon; the **Caelari Skyreach** is a terraced plateau thirty metres up. Each people
begins at home in its own region — initial geography, not a faction wall; within a week somebody has
always crossed a border. You can tell all three apart from a hilltop without reading a single label.

And the camera finally works on a laptop. **Looking around no longer requires pointer lock, or a
click, or anything at all beyond a two-finger swipe.** Hold `W`, swipe to turn, keep running — the
key stays down, which it did not before. Click-drag looks too, `C` sweeps the camera back behind you,
and pointer lock is still there for mouse users who want it, as an option nobody has to find.

**v0.7B** gave walking around a point —

> *Leaving home earns you a reason to come back.*

EDEN's first complete loop. The colony's **Fabricator** works, and Petra — the fabrication technician
who keeps it through the working day — will tell you what it needs. It needs material the Riverlands
do not have. **Salvaged Alloy** comes out of the wreck scattered along the descent path, **Conductive
Ore** out of the Ashlands mineral seams, **Aether Crystal** only off the Skyreach at altitude. Each is
worked with its own verb over a real interaction, and each node holds a finite amount.

Bring all three home and the Fabricator builds the **Pathfinder Scanner Mk I**. Press `Q` and a pulse
goes out; for a few seconds ARI can name and mark every usable material signature within about sixty
metres. It is local and it expires — it answers *is there anything useful near me*, not *where is
everything in the Skyreach*. There are two other recipes: a Field Medkit, and an Energy Cell that
discharges into the scanner for one long-range sweep.

Left home, found something, brought it back, turned it into technology, went further. That is the loop.

**v0.8** put something in the way of it —

> *A world with teeth, not a combat game.*

The Fabricator will cut you an **Arc Blade Mk I** out of the same three materials. It is the only
weapon in EDEN and there is no second one coming: one blade, a light attack that chains three times,
a heavy attack that commits, a dodge roll with real invulnerability, and a lock-on. Every one of them
has a left-hand key as well as a mouse button — `J`, `K`, `Space`, `L` — because EDEN is tested on a
laptop with no mouse, and a trackpad cannot hold a look-swipe and click at the same time.

Two things out there will fight you. The **Rakhor** is territorial rather than murderous: it notices
you at twenty metres, squares up when you come inside nine, and holds that warning for two and a half
seconds before it commits — back away in that window and it lets you go. The **Warden Wisp** is not an
animal at all. It hovers on the **Sunken Ring**, a circle of half-buried pylons in the ground between
the Ashlands and the Skyreach that predates every colony signal in the valley, and it treats the ring
as something to be guarded. Nobody in EDEN explains what it is guarding, or what the ring is, or who
built it. v0.8 raises the question and leaves it standing.

Nothing ever hits you without a visible wind-up first, nothing chases you past its own ground, and
nothing hunts you inside Human Landing. Emerson going down does **not** reset the world: ARI fires an
emergency beacon, he wakes up at the landing site having lost a quarter of what he was carrying, and
the valley carries on the entire time — same settlers, same relationships, same half-built shelter,
clock still running. Capabilities are never taken away. Settlers who see a roused predator drop what
they were doing and run; they never fight, and they go back to their lives afterwards.

Disabling a Warden leaves a **Synthetic Core Fragment**. Take one to Petra and she will tell you,
straight out, that she has no idea what it is — only that it is nothing anyone here can make, and that
it is still drawing power sitting on her bench.

**v0.9** made surviving it a skill —

> *A world with teeth is only interesting if the teeth are fair.*

v0.8 proved EDEN could hurt you. v0.9 is about whether you want to engage with
that. The Arc Blade's light chain is now three genuinely different swings — a
quick diagonal, a reverse cut, and a slower finisher that carries most of the
stagger — and a press made mid-swing is **buffered** rather than dropped, so
chaining no longer means catching a quarter-second window on a keyboard. The
heavy attack is not a bigger light: it commits, it roots you, and it exists to
punish an enemy's recovery.

Landing a full sequence **staggers** what you hit. One number per creature, no
poise bars, nothing on screen — but a Rakhor rocked out of its stance is an
opening you earned, and the immunity window afterwards means it can never
become a stun-lock. The same protection runs the other way: Emerson flinches
when hit, briefly, and can never be chained into helplessness.

Both encounters now fight in their own way. The **Rakhor** observes, warns,
*circles* looking for an angle, then commits to a lunge — and the direction of
that lunge is locked the instant the wind-up starts, which is what makes a
well-timed dodge actually work. Its tell runs on four channels at once now: the
dorsal ridge lights, the body drops and coils, the head lowers, and a ring
paints on the ground beneath it, because a change of pose is a few pixels at
twenty metres and a two-metre ring is not. Wound one badly enough and it
breaks off rather than fighting to the death.

The **Warden Wisp** does not brawl. It holds a standoff, charges a beam you can
see coming, and fires along a line committed at the start of the charge —
stepping out of that line is the answer. Crowd it and a close-range pulse burst
shoves you back out. And both of them now have lives of their own: the Rakhor
stalks smaller fauna around its range, the Warden walks its own pylons, and
small animals give a roused predator a wide berth. In v0.8 the ancient machine
guardian spent its days grazing on glowplants.

Disabling a Warden still yields a **Synthetic Core Fragment** — and now there is
exactly one thing to do with it. Petra will wire it into the blade as an **Arc
Blade Capacitor**: not more damage, more *stagger*, which is the difference
between a Warden you can only chip at and a Warden you can rock. That closes the
loop — danger, survive, salvage, return, upgrade, become better at surviving.

Combat has sound now, all of it synthesised in the browser from oscillators and
generated noise. There are no audio files in this repository.

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
node scripts/tour-v08.mjs      # visual tour: screenshots of the encounters
node scripts/playtest-v09.mjs  # the whole combat loop, driven end to end
```

The browser scripts pin the world seed (`EDEN_SEED`, default `31337`) so a run is reproducible.
Properties that should hold across *many* valleys belong in the headless suite, which can generate
hundreds of them; the browser scripts exist to walk one world end to end.

## The three experiences

- **LIVE** — inhabit the world as Emerson, third person. Explore, gather glowberries, talk to settlers,
  earn Lumi's trust. The HUD tells you where you are, which way you are facing and what you can reach —
  and nothing else. ARI names each region and landmark the first time you enter it, and identifies
  whatever you look at. She only ever speaks about things Emerson was actually there to see.
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

  Select a settler for **what they believe others expect** — each belief with how sure they are, where
  they got it (watched it happen, were told outright, heard it from someone by name), and whether it
  has gone long enough unconfirmed to be doubtful — and for the **local expectations** they have
  generalized, with the evidence for and against. On any structure you can pick a person and read it
  *through their eyes*: what each claimant actually expects on the left, that person's picture of it on
  the right, with DIFFERS marked where the two part company. Only Creator Mode gets both columns.
  The settler living in the valley has just the one, and no way of knowing when they are wrong.

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
| Trackpad swipe / click-drag | Look around — no clicking required |
| `C` | Recenter the camera behind Emerson |
| `[` `]` / pinch | Zoom the camera in and out |
| `Shift` | Sprint |
| `V` | Jump |
| `E` | Salvage / extract / harvest · use the Fabricator · gather · talk · help build |
| `Q` | Pathfinder Scanner sweep (once built) |
| `H` | Use a Field Medkit |
| `F` | Offer a glowberry (Lumi decides whether to take it) |
| `R` | Ask a settler's permission to use their shelter |
| `J` / left click | Light attack — a three-swing sequence |
| `K` / right click | Heavy attack — slower, hits much harder |
| `Space` | Dodge roll (brief invulnerability) |
| `L` | Lock on / release |
| `Tab` | Toggle Creator Mode |
| `1 / 2 / 3` | Sim speed 1× / 5× / 20× |
| `P` | Pause |
| `Esc` | Help and camera settings |
| `F3` | Debug overlay (fps, achieved sim rate, seed) |

Camera look is *camera control only* — it never means taking control of anyone, and it never
interrupts movement. Look speed, invert-Y and optional mouse capture live behind `Esc` and persist
between sessions. Creator Mode always keeps your cursor.

## The three regions

| Region | Ground | Who settles there |
| --- | --- | --- |
| **Human Riverlands** | Low green plain, river, lake, landing wreck | Humans |
| **Veyra Ashlands** | Dry rust mesa, cut canyons, mineral seams | Veyra |
| **Caelari Skyreach** | Terraced plateau ~30m up, cliffs, vantage points | Caelari |

Emerson starts at **Human Landing**: the drop pod, its scattered hull panels, a materials staging
area, the working Fabricator, and a hearth that was lit before the game began. Timber grows in the
green and stone lies in the rock, so every people has one material at hand and must travel for the
other — and the same is true of the three fabrication materials, which is what turns the map into a
reason to walk across it.

| Material | Found in | Fabricates |
| --- | --- | --- |
| **Salvaged Alloy** | Riverlands wreckage | structure and casings |
| **Conductive Ore** | Ashlands seams | energy transmission |
| **Aether Crystal** | Skyreach, high ground only | scanning and focusing |

## Architecture

The non-negotiable rule: **simulation state is fully separated from rendering.**

```
src/sim/      Pure TypeScript simulation. No Three.js, no React.
              World, agents, needs, utility-AI goals + reasons, memories,
              structured relationships (affinity/trust/familiarity/fear with
              recorded history), structures and construction with full
              provenance, agent-relative claims and informal norms,
              second-order beliefs about what other people expect (with
              provenance, confidence and decay) and the private
              generalizations drawn from them, player materials,
              data-driven fabrication recipes and the Pathfinder Scanner,
              player combat (windowed strikes with a one-deep input buffer,
              dodge i-frames, lock-on, soft target assist, stagger) and the
              threat state machine both dangerous archetypes share,
              wildlife, Lumi, chronicle (with structured
              who/where/why/effects payloads), landmarks, three biome
              regions, deterministic dialogue, temporal summaries,
              terrain math, seeded RNG, creator interventions.
src/state/    Thin Zustand store for UI-reactive state (mode, speed,
              selection, ~5 Hz UI pulse). Never per-tick data.
src/game/     Fixed-timestep loop (30 Hz sim steps × speed multiplier),
              global input, and procedurally-synthesised combat audio
              (no audio files, no external assets).
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
