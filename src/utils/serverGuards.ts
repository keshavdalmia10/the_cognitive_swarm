export type SwarmPhase = 'divergent' | 'convergent' | 'forging';

const VALID_PHASES = new Set<string>(['divergent', 'convergent', 'forging']);

export function isValidPhase(phase: unknown): phase is SwarmPhase {
  return typeof phase === 'string' && VALID_PHASES.has(phase);
}

export interface ParticipantRecord {
  socketId: string;
  userName: string;
  role: 'admin' | 'participant';
  joinedAt: number;
  contributionCount: number;
  lastContributionAt: number | null;
}

export function isAdmin(participant: ParticipantRecord | null | undefined): boolean {
  return participant?.role === 'admin';
}
