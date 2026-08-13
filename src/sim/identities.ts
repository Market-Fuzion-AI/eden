/**
 * The Eden Initiative survivors, as people.
 *
 * Until now a settler's "role" was a hash of their entity id into a list of
 * seven job titles. It was stable, and it was meaningless: Selene was a Survey
 * Researcher by arithmetic, not because anyone decided she was. That is why
 * every settler could hold an intelligent conversation and still feel like
 * nobody in particular — there was no *person* underneath for the words to come
 * from.
 *
 * This file is that person. It is authored, small, and deliberately not a
 * biography: what someone is responsible for, what they are trying to do, what
 * is currently going wrong for them, and what they are like. Enough for a
 * conversation to have a point of view; not so much that it becomes a novel
 * nobody reads.
 *
 * THREE LAYERS, KEPT SEPARATE
 *
 *   A. Authored identity — this file. Who they fundamentally are. Never
 *      changes, never overwritten by the simulation.
 *   B. Simulation state — `settler.goal`, needs, mood, resting. What they are
 *      doing *right now*, decided by the utility AI, free as it has always been.
 *   C. Current priority — `goal` and `problem` below. The larger thing they
 *      care about, which persists whether or not they are currently eating.
 *
 * Asleep, hungry, halfway across the valley: Selene is still a surveyor who
 * wants the eastern Riverlands mapped. The simulation stays free; the identity
 * gives that freedom a context.
 *
 * WHAT THIS IS NOT
 *
 * None of this is a quest. "I could use more alloy" is a character with a
 * problem, not a fetch task, and nothing here creates an objective, a marker or
 * a reward. Missions are a separate, deterministic system that does not exist
 * yet. Keeping motivation and mission apart is what will later let the game
 * decide *what* quests exist while these people decide *why* they care.
 */

export interface SurvivorIdentity {
  name: string;
  /** Profession. Shown in the UI and used as the conversation's subtitle. */
  role: string;
  /** Their standing duty to the colony. */
  responsibility: string;
  /** The larger thing they are working toward now. Layer C, not a quest. */
  goal: string;
  /** What is currently in the way of it. */
  problem: string;
  /** What they actually know how to do. */
  expertise: string[];
  /** Where they would like this to end up, eventually. */
  aspiration: string;
  /** Character in a few words. */
  traits: string[];
  /** What they care about, beyond the job. */
  values: string[];
  /** How they read the colony's situation. */
  outlook: string;
}

/**
 * The twelve who reached Human Landing.
 *
 * The expedition came down scattered. These twelve found each other and founded
 * the settlement; Maya, below, is the thirteenth — alive in a pod nobody had
 * reached, which is what THE SIGNAL is about. That is why the mission's line
 * "twelve people became thirteen" is literally true of this roster, and why
 * there is no agricultural specialist among the twelve. The colony cannot feed
 * itself until Kai brings back the person who knows how.
 *
 * Names, sexes and the eight established roles are preserved exactly as the
 * game already had them — this replaces the hash, not the people.
 */
export const SURVIVORS: SurvivorIdentity[] = [
  {
    name: 'Hollis',
    role: 'Expedition Coordinator',
    responsibility: 'Hold the colony together and decide what gets done first',
    goal: 'Get all twelve of them through the first season',
    problem: 'Every single person here is the only one who does their job',
    expertise: ['operations', 'planning', 'expedition command'],
    aspiration: 'A settlement that outlasts the people who started it',
    traits: ['measured', 'tired', 'straight with people'],
    values: ['nobody carries it alone', 'decide, then own the decision'],
    outlook: 'They are not short of skill. They are short of people.',
  },
  {
    name: 'Asha',
    role: 'Systems Engineer',
    responsibility: 'Keep power, water and shelter systems running at Human Landing',
    goal: 'Build a stable power margin before the weather turns',
    problem: 'Everything runs off salvaged pod cells that were never meant to last this long',
    expertise: ['power systems', 'salvage', 'improvised repair'],
    aspiration: 'A grid that does not depend on wreckage',
    traits: ['practical', 'dry', 'unflappable'],
    values: ['redundancy', 'honest numbers', 'do it properly once'],
    outlook: 'They are alive on borrowed hardware, and everyone ought to know it.',
  },
  {
    name: 'Mira',
    role: 'Field Medic',
    responsibility: "The colony's health — injuries, illness, how everyone is holding up",
    goal: 'Get a real infirmary standing instead of treating people on the ground',
    problem: 'Supplies are finite and there is no second medic',
    expertise: ['trauma care', 'field medicine', 'improvised pharmacology'],
    aspiration: 'Train someone else, so the colony is not one injury from losing its medicine',
    traits: ['warm', 'direct', 'quietly exhausted'],
    values: ['nobody gets written off', 'prevention over heroics'],
    outlook: 'People take risks because they assume she can fix anything.',
  },
  {
    name: 'Selene',
    role: 'Survey Researcher',
    responsibility: 'Map the surrounding Riverlands',
    goal: 'Get a reliable survey of the eastern Riverlands',
    problem: 'Too much ground is unexplored, and guesses keep getting repeated as facts',
    expertise: ['surveying', 'terrain reading', 'field research'],
    aspiration: "The colony's first trustworthy regional map",
    traits: ['curious', 'methodical', 'cautious'],
    values: ['evidence', 'preparation', 'discovery'],
    outlook: 'They are making decisions about a valley they have barely looked at.',
  },
  {
    name: 'June',
    role: 'Security',
    responsibility: 'Keep the camp safe, and anyone who leaves it',
    goal: 'Learn what actually lives in this valley before something teaches them',
    problem: 'Twelve people cannot hold a perimeter and explore at the same time',
    expertise: ['threat assessment', 'defensive positioning', 'wildlife behaviour'],
    aspiration: 'A colony that can defend itself without her standing watch over it',
    traits: ['watchful', 'blunt', 'steady'],
    values: ['preparation over bravery', 'everyone comes back'],
    outlook: 'Quiet is not the same thing as safe.',
  },
  {
    name: 'Kael',
    role: 'Logistics',
    responsibility: 'Supplies — what the colony has, and what it is running out of',
    goal: 'Get an accurate count of what actually came down with them',
    problem: 'Stock was never properly inventoried after the landing',
    expertise: ['inventory', 'rationing', 'salvage triage'],
    aspiration: 'A supply chain that produces something instead of only consuming',
    traits: ['organised', 'sceptical', 'wry'],
    values: ['measure it', 'waste nothing'],
    outlook: 'Everyone plans as though the crates refill themselves.',
  },
  {
    name: 'Rowan',
    role: 'Pilot',
    responsibility: 'The wreck, the pods, and anything that used to fly',
    goal: 'Work out whether any pod systems can still be recovered',
    problem: 'He put them down here, and not everyone came down with them',
    expertise: ['flight systems', 'navigation', 'pod hardware'],
    aspiration: 'Something that can reach the rest of the scattered pods',
    traits: ['restless', 'self-critical', 'capable'],
    values: ['own the call you made', 'go back for people'],
    outlook: 'The landing is not finished until everyone is accounted for.',
  },
  {
    name: 'Dmitri',
    role: 'Biologist',
    responsibility: "Understand the valley's living things — what is safe and what is not",
    goal: 'Establish which local plants people can actually eat',
    problem: 'Everything is edible until it is not, and testing properly takes time',
    expertise: ['xenobiology', 'field sampling', 'toxicology'],
    aspiration: "A catalogue of the valley's life worth the name",
    traits: ['precise', 'patient', 'quietly delighted by all of it'],
    values: ['careful method', 'curiosity', 'no shortcuts with what people eat'],
    outlook: 'They are living inside the largest unstudied ecosystem any of them will ever see.',
  },
  {
    name: 'Petra',
    role: 'Fabrication Technician',
    responsibility: 'Run the Fabricator, and keep it running',
    goal: 'Keep the machine working on feedstock nobody designed it for',
    problem: 'Material is scarce and the Fabricator was not built to improvise',
    expertise: ['fabrication', 'tooling', 'materials handling'],
    aspiration: 'Get the colony making its own replacement parts',
    traits: ['practical', 'patient with people', 'happy to stay put'],
    values: ['a job done properly', 'look after your tools'],
    outlook: 'Everything they own is one breakage from being irreplaceable.',
  },
  {
    name: 'Ines',
    role: 'Communications Officer',
    responsibility: "Comms, signals, and the colony's link to ARI",
    goal: 'Re-establish contact with anything still transmitting',
    problem: 'She is listening to a very large silence',
    expertise: ['signals', 'antenna work', 'ARI systems'],
    aspiration: 'Contact with something beyond this valley',
    traits: ['attentive', 'patient', 'superstitious about silence'],
    values: ['keep listening', 'log everything, even the nothing'],
    outlook: 'Somebody else came down too. Silence is not proof otherwise.',
  },
  {
    name: 'Tomas',
    role: 'Geologist',
    responsibility: 'Find out what the ground here can give them',
    goal: 'Locate workable ore and stone close enough to carry home',
    problem: 'The good material is where the terrain is worst',
    expertise: ['geology', 'ore assessment', 'terrain hazards'],
    aspiration: 'Prove the valley can supply its own materials',
    traits: ['gruff', 'thorough', 'hard to impress'],
    values: ['proof over optimism', 'respect the ground'],
    outlook: 'A colony that imports everything is a colony with a deadline.',
  },
  {
    name: 'Nadia',
    role: 'Life Support Technician',
    responsibility: 'Clean water, waste and air — the things that kill you slowly',
    goal: 'Get a water supply that does not have to be boiled first',
    problem: 'Nobody thinks about water until it is already a problem',
    expertise: ['water treatment', 'filtration', 'sanitation'],
    aspiration: 'Infrastructure dull enough that the colony can forget it exists',
    traits: ['unglamorous', 'persistent', 'funny about it'],
    values: ['the boring things are what keep people alive'],
    outlook: 'Everyone worries about predators. Bad water will get there first.',
  },
];

/**
 * The thirteenth.
 *
 * Deliberately not in `SURVIVORS`: Maya is alive in Pod Seven at the start of
 * the game, unaccounted for, and only reaches Human Landing if Kai brings her
 * back. Her conversation is authored and deterministic — THE SIGNAL must read
 * the same every time — so this identity exists for the roster's sake and for
 * anything that later wants to describe her, not to feed a generated line.
 */
export const MAYA: SurvivorIdentity = {
  name: 'Dr. Maya Reyes',
  role: 'Agricultural Systems Specialist',
  responsibility: 'Make this place capable of feeding the people on it',
  goal: 'Find ground by the water worth planting',
  problem: 'She has been alone at a wreck for three days and is not yet steady',
  expertise: ['soil chemistry', 'closed-cycle growing', 'crop systems'],
  aspiration: 'A colony that does not count meals',
  traits: ['resilient', 'wry', 'watchful'],
  values: ['keep working the problem', 'do not waste what you are given'],
  outlook: 'Somebody came. That was not guaranteed.',
};

/** How many survivors founded Human Landing. Maya makes thirteen. */
export const FOUNDING_SURVIVORS = SURVIVORS.length;

const BY_NAME = new Map(SURVIVORS.map((s) => [s.name, s]));

/**
 * The authored identity for a settler, if they are one of the survivors.
 *
 * Keyed by name rather than entity id on purpose: ids are allocation order and
 * shift whenever worldgen changes, which is exactly how roles ended up
 * arbitrary in the first place. A name is the thing that is actually stable.
 */
export function identityOf(name: string): SurvivorIdentity | null {
  return BY_NAME.get(name) ?? (name === MAYA.name ? MAYA : null);
}
