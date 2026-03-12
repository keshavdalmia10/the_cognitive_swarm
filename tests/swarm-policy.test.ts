import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAudienceNudge,
  buildDevSpaHtml,
  dedupeById,
  getQuietParticipantNames,
  shouldAutoBroadcastSuggestion,
  shouldSkipRepeatedSuggestion,
} from '../src/utils/swarmPolicy.ts';

test('auto suggestion triggers after 30 seconds of inactivity in divergent phase', () => {
  assert.equal(
    shouldAutoBroadcastSuggestion({
      phase: 'divergent',
      ideaCount: 3,
      lastIdeaTime: 1000,
      lastDirectionSuggestionTime: 1000,
      now: 31000,
    }),
    true,
  );
});

test('auto suggestion does not trigger before the idle threshold', () => {
  assert.equal(
    shouldAutoBroadcastSuggestion({
      phase: 'divergent',
      ideaCount: 3,
      lastIdeaTime: 5000,
      lastDirectionSuggestionTime: 0,
      now: 34000,
    }),
    false,
  );
});

test('auto suggestion does not trigger outside divergent phase or without ideas', () => {
  assert.equal(
    shouldAutoBroadcastSuggestion({
      phase: 'convergent',
      ideaCount: 4,
      lastIdeaTime: 0,
      lastDirectionSuggestionTime: 0,
      now: 60000,
    }),
    false,
  );
  assert.equal(
    shouldAutoBroadcastSuggestion({
      phase: 'divergent',
      ideaCount: 0,
      lastIdeaTime: 0,
      lastDirectionSuggestionTime: 0,
      now: 60000,
    }),
    false,
  );
});

test('auto suggestion can trigger when quiet participants need a nudge', () => {
  assert.equal(
    shouldAutoBroadcastSuggestion({
      phase: 'divergent',
      ideaCount: 0,
      quietParticipantCount: 2,
      lastIdeaTime: 1000,
      lastDirectionSuggestionTime: 0,
      now: 32000,
    }),
    true,
  );
});

test('getQuietParticipantNames returns only quiet participants after the grace period', () => {
  const names = getQuietParticipantNames({
    now: 60000,
    participants: [
      { name: 'Avery', joinedAt: 1000, contributionCount: 0, role: 'participant' },
      { name: 'Blair', joinedAt: 50000, contributionCount: 0, role: 'participant' },
      { name: 'Casey', joinedAt: 2000, contributionCount: 1, role: 'participant' },
      { name: 'Dana', joinedAt: 1500, contributionCount: 0, role: 'admin' },
    ],
  });

  assert.deepEqual(names, ['Avery']);
});

test('buildAudienceNudge creates playful copy with names', () => {
  const prompt = buildAudienceNudge({ quietNames: ['Avery', 'Blair'] });

  assert.ok(prompt);
  assert.match(prompt.suggestion, /Avery and Blair/);
  assert.match(prompt.suggestion, /bold idea each/i);
  assert.match(prompt.rationale || '', /quieter voices/i);
});

test('buildAudienceNudge can praise active contributors while nudging quiet ones', () => {
  const prompt = buildAudienceNudge({
    quietNames: ['Avery'],
    praisedNames: ['Jordan', 'Parker'],
  });

  assert.ok(prompt);
  assert.match(prompt.suggestion, /Jordan and Parker/);
  assert.match(prompt.suggestion, /Avery/);
  assert.match(prompt.rationale || '', /Celebrate momentum/i);
});

test('auto suggestion triggers exactly on idle and cooldown boundaries', () => {
  assert.equal(
    shouldAutoBroadcastSuggestion({
      phase: 'divergent',
      ideaCount: 2,
      lastIdeaTime: 10000,
      lastDirectionSuggestionTime: 10000,
      now: 40000,
    }),
    true,
  );
});

test('auto suggestion respects custom idle and cooldown thresholds', () => {
  assert.equal(
    shouldAutoBroadcastSuggestion({
      phase: 'divergent',
      ideaCount: 5,
      lastIdeaTime: 20000,
      lastDirectionSuggestionTime: 10000,
      now: 50000,
      idleMs: 25000,
      cooldownMs: 35000,
    }),
    true,
  );
  assert.equal(
    shouldAutoBroadcastSuggestion({
      phase: 'divergent',
      ideaCount: 5,
      lastIdeaTime: 26000,
      lastDirectionSuggestionTime: 10000,
      now: 50000,
      idleMs: 25000,
      cooldownMs: 35000,
    }),
    false,
  );
});

test('repeated auto suggestions are suppressed within the duplicate window', () => {
  assert.equal(
    shouldSkipRepeatedSuggestion({
      reason: 'auto',
      suggestion: 'Explore stakeholder incentives',
      lastSuggestionKey: 'explore stakeholder incentives',
      lastSuggestionTime: 1000,
      now: 119000,
    }),
    true,
  );
});

test('duplicate detection is case-insensitive and trims suggestion whitespace', () => {
  assert.equal(
    shouldSkipRepeatedSuggestion({
      reason: 'auto',
      suggestion: '  Explore Stakeholder Incentives  ',
      lastSuggestionKey: 'explore stakeholder incentives',
      lastSuggestionTime: 1000,
      now: 2000,
    }),
    true,
  );
});

test('auto suggestions are allowed again after the duplicate window expires', () => {
  assert.equal(
    shouldSkipRepeatedSuggestion({
      reason: 'auto',
      suggestion: 'Explore stakeholder incentives',
      lastSuggestionKey: 'explore stakeholder incentives',
      lastSuggestionTime: 1000,
      now: 121001,
    }),
    false,
  );
});

test('different suggestions are never suppressed as duplicates', () => {
  assert.equal(
    shouldSkipRepeatedSuggestion({
      reason: 'auto',
      suggestion: 'Explore teacher incentives',
      lastSuggestionKey: 'explore stakeholder incentives',
      lastSuggestionTime: 1000,
      now: 2000,
    }),
    false,
  );
});

test('manual suggestions are never suppressed by duplicate detection', () => {
  assert.equal(
    shouldSkipRepeatedSuggestion({
      reason: 'manual',
      suggestion: 'Explore stakeholder incentives',
      lastSuggestionKey: 'explore stakeholder incentives',
      lastSuggestionTime: 1000,
      now: 2000,
    }),
    false,
  );
});

test('dev SPA html includes the Vite client, root node, and app entrypoint', () => {
  const html = buildDevSpaHtml();
  assert.match(html, /\/@vite\/client/);
  assert.match(html, /\/src\/main\.tsx/);
  assert.match(html, /<div id="root"><\/div>/);
});

test('dev SPA html uses a provided custom title', () => {
  const html = buildDevSpaHtml('Classroom Swarm');
  assert.match(html, /<title>Classroom Swarm<\/title>/);
});

test('dedupeById keeps the latest item for each identifier', () => {
  assert.deepEqual(
    dedupeById([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
      { id: 'a', value: 3 },
    ]),
    [
      { id: 'a', value: 3 },
      { id: 'b', value: 2 },
    ],
  );
});

test('dedupeById handles empty input and numeric identifiers', () => {
  assert.deepEqual(dedupeById([]), []);
  assert.deepEqual(
    dedupeById([
      { id: 1, value: 'first' },
      { id: 2, value: 'second' },
      { id: 1, value: 'updated' },
    ]),
    [
      { id: 1, value: 'updated' },
      { id: 2, value: 'second' },
    ],
  );
});
