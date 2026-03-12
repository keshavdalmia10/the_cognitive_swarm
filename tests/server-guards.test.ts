import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidPhase, isAdmin } from '../src/utils/serverGuards.ts';

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
