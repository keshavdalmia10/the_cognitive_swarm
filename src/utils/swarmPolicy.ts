export type SwarmPhase = 'divergent' | 'convergent' | 'forging';
export type SuggestionReason = 'auto' | 'manual';
export type DirectionSuggestionKind = 'direction' | 'audience_nudge';

export interface AutoSuggestionContext {
  phase: SwarmPhase | string;
  ideaCount: number;
  quietParticipantCount?: number;
  lastIdeaTime: number;
  lastDirectionSuggestionTime: number;
  now: number;
  idleMs?: number;
  cooldownMs?: number;
}

export interface RepeatedSuggestionContext {
  reason: SuggestionReason;
  suggestion: string;
  lastSuggestionKey: string;
  lastSuggestionTime: number;
  now: number;
  duplicateWindowMs?: number;
}

export interface QuietParticipant {
  name: string;
  joinedAt: number;
  contributionCount: number;
  role?: 'admin' | 'participant' | string;
}

export interface QuietParticipantContext {
  participants: QuietParticipant[];
  now: number;
  minJoinMs?: number;
  maxNames?: number;
}

export interface DirectionSuggestionPayload {
  suggestion: string;
  rationale?: string;
  reason: SuggestionReason;
  kind: DirectionSuggestionKind;
  createdAt: number;
}

export interface AudienceNudgeContext {
  quietNames: string[];
  praisedNames?: string[];
}

export function shouldAutoBroadcastSuggestion({
  phase,
  ideaCount,
  quietParticipantCount = 0,
  lastIdeaTime,
  lastDirectionSuggestionTime,
  now,
  idleMs = 30000,
  cooldownMs = 30000,
}: AutoSuggestionContext) {
  return (
    phase === 'divergent' &&
    (ideaCount > 0 || quietParticipantCount > 0) &&
    now - lastIdeaTime >= idleMs &&
    now - lastDirectionSuggestionTime >= cooldownMs
  );
}

export function shouldSkipRepeatedSuggestion({
  reason,
  suggestion,
  lastSuggestionKey,
  lastSuggestionTime,
  now,
  duplicateWindowMs = 120000,
}: RepeatedSuggestionContext) {
  if (reason !== 'auto') return false;
  return (
    suggestion.trim().toLowerCase() === lastSuggestionKey &&
    now - lastSuggestionTime < duplicateWindowMs
  );
}

export function getQuietParticipantNames({
  participants,
  now,
  minJoinMs = 20000,
  maxNames = 3,
}: QuietParticipantContext) {
  return participants
    .filter((participant) => {
      const cleanedName = participant.name.trim();
      if (!cleanedName) return false;
      if ((participant.role || 'participant') !== 'participant') return false;
      if (participant.contributionCount > 0) return false;
      return now - participant.joinedAt >= minJoinMs;
    })
    .sort((left, right) => left.joinedAt - right.joinedAt)
    .slice(0, maxNames)
    .map((participant) => participant.name.trim());
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function buildAudienceNudge({ quietNames: names, praisedNames = [] }: AudienceNudgeContext) {
  const quietNames = names
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 3);
  const activeNames = praisedNames
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => !quietNames.includes(name))
    .slice(0, 2);

  if (quietNames.length === 0 && activeNames.length === 0) {
    return null;
  }

  const joinedQuietNames = joinNames(quietNames);
  const joinedActiveNames = joinNames(activeNames);

  if (quietNames.length === 0) {
    return {
      suggestion: activeNames.length > 1
        ? `Quick applause for ${joinedActiveNames}. Strong momentum. Who wants to top that with a fresh twist?`
        : `Quick applause for ${joinedActiveNames}. That idea had real spark. Who wants to build on it?`,
      rationale: 'Keep the room energized by praising momentum and inviting the next contribution.',
    };
  }

  const quietPlural = quietNames.length > 1;
  const praiseLead = activeNames.length > 0
    ? activeNames.length > 1
      ? `Quick applause for ${joinedActiveNames} for keeping the swarm lively. `
      : `Quick applause for ${joinedActiveNames} for that strong push. `
    : '';

  return {
    suggestion: quietPlural
      ? `${praiseLead}${joinedQuietNames}, no hiding in the balcony. Drop us one bold idea each.`
      : `${praiseLead}${joinedQuietNames}, you are officially off mute. Toss one bold idea into the swarm.`,
    rationale: activeNames.length > 0
      ? 'Celebrate momentum while inviting quieter voices in before the room converges too early.'
      : 'Invite quieter voices in before the room converges too early.',
  };
}

export function buildDevSpaHtml(title = 'The Cognitive Swarm') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <script type="module" src="/@vite/client"></script>
    <script type="module" src="/src/main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
}

export function dedupeById<T extends { id: string | number }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}
