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

export const INITIAL_CREDITS = 100;

export function computeQuadraticCost(currentVotes: number, newVotes: number): number {
  return (newVotes * newVotes) - (currentVotes * currentVotes);
}

export interface VoteValidation {
  currentVotes: number;
  credits: number;
  delta: number;
}

export interface VoteResult {
  allowed: boolean;
  newVotes: number;
  cost: number;
}

export function validateVote({ currentVotes, credits, delta }: VoteValidation): VoteResult {
  const newVotes = currentVotes + delta;
  if (newVotes < 0) return { allowed: false, newVotes: currentVotes, cost: 0 };
  const cost = computeQuadraticCost(currentVotes, newVotes);
  if (credits - cost < 0) return { allowed: false, newVotes: currentVotes, cost: 0 };
  return { allowed: true, newVotes, cost };
}
