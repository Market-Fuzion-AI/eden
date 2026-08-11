import { SETTLER } from './config';
import type { AgentCommon, MemoryEntry } from './types';

/** Record a structured memory, keeping only a bounded number of recent entries. */
export function remember(agent: AgentCommon, entry: MemoryEntry): void {
  agent.memories.push(entry);
  if (agent.memories.length > SETTLER.maxMemories) {
    agent.memories.splice(0, agent.memories.length - SETTLER.maxMemories);
  }
}

/** Convert a structured memory to readable text (UI-only concern). */
export function memoryText(m: MemoryEntry): string {
  switch (m.type) {
    case 'resource_discovered':
      return `Discovered ${m.place ?? 'a resource'}`;
    case 'ate':
      return `Ate at ${m.place ?? 'a food source'}`;
    case 'rested':
      return `Rested safely at ${m.place ?? 'camp'}`;
    case 'social_positive':
      return `Had a good conversation with ${m.subjectName ?? 'someone'}`;
    case 'social_negative':
      return `Had a tense exchange with ${m.subjectName ?? 'someone'}`;
    case 'fed_by_emerson':
      return 'Emerson gave me food';
    case 'talked_to_emerson':
      return `Spoke with Emerson${m.place ? ` at ${m.place}` : ''}`;
    case 'threatened':
      return `Was threatened by ${m.subjectName ?? 'something'}`;
    case 'explored':
      return `Explored ${m.place ?? 'unfamiliar ground'}`;
    case 'saw_emerson':
      return 'Watched the tall newcomer from a distance';
    default:
      return 'Something happened';
  }
}
