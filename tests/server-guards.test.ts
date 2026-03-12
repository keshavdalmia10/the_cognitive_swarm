import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPhase, isAdmin, computeQuadraticCost, validateVote } from '../src/utils/serverGuards.ts';

test('isValidPhase accepts only the three valid phases', () => {
  assert.equal(isValidPhase('divergent'), true);
  assert.equal(isValidPhase('convergent'), true);
  assert.equal(isValidPhase('forging'), true);
  assert.equal(isValidPhase('invalid'), false);
  assert.equal(isValidPhase(''), false);
  assert.equal(isValidPhase(undefined), false);
  assert.equal(isValidPhase(123), false);
});

test('isAdmin checks participant role', () => {
  const adminParticipant = { socketId: 's1', userName: 'Admin', role: 'admin' as const, joinedAt: 0, contributionCount: 0, lastContributionAt: null };
  const regularParticipant = { socketId: 's2', userName: 'User', role: 'participant' as const, joinedAt: 0, contributionCount: 0, lastContributionAt: null };
  assert.equal(isAdmin(adminParticipant), true);
  assert.equal(isAdmin(regularParticipant), false);
  assert.equal(isAdmin(undefined), false);
  assert.equal(isAdmin(null), false);
});

test('computeQuadraticCost calculates cost difference correctly', () => {
  assert.equal(computeQuadraticCost(0, 1), 1);   // 1² - 0² = 1
  assert.equal(computeQuadraticCost(1, 2), 3);   // 4 - 1 = 3
  assert.equal(computeQuadraticCost(2, 3), 5);   // 9 - 4 = 5
  assert.equal(computeQuadraticCost(3, 2), -5);  // 4 - 9 = -5 (refund)
  assert.equal(computeQuadraticCost(1, 0), -1);  // 0 - 1 = -1 (refund)
});

test('validateVote rejects votes that exceed available credits', () => {
  const result = validateVote({ currentVotes: 0, credits: 0, delta: 1 });
  assert.equal(result.allowed, false);
});

test('validateVote accepts votes within budget', () => {
  const result = validateVote({ currentVotes: 0, credits: 100, delta: 1 });
  assert.equal(result.allowed, true);
  assert.equal(result.newVotes, 1);
  assert.equal(result.cost, 1);
});

test('validateVote rejects negative vote counts', () => {
  const result = validateVote({ currentVotes: 0, credits: 100, delta: -1 });
  assert.equal(result.allowed, false);
});

test('validateVote allows downvotes that refund credits', () => {
  const result = validateVote({ currentVotes: 3, credits: 10, delta: -1 });
  assert.equal(result.allowed, true);
  assert.equal(result.newVotes, 2);
  assert.equal(result.cost, -5);
});
