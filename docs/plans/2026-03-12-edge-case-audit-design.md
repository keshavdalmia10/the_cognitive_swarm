# Edge Case Audit — The Cognitive Swarm

**Date:** 2026-03-12
**Scope:** Comprehensive audit of backend, frontend, audio/video, and multi-user edge cases.
**Approach:** Full catalog with severity ratings, then prioritized fix waves.

---

## Section 1: Backend — Socket & State Management

| # | Edge Case | Severity | Location |
|---|-----------|----------|----------|
| B1 | No input validation on `set_topic` — any client can change the topic, not just admin. | Critical | `server.ts:931-934` |
| B2 | No input validation on `set_phase` — any client can change phase. Accepts arbitrary strings. | Critical | `server.ts:1045-1048` |
| B3 | `add_idea` has no text sanitization or length limit — empty, huge, or special-char strings accepted. | High | `server.ts:937-959` |
| B4 | `update_idea_weight` has no server-side vote validation — clients can send any weightChange. Quadratic voting is frontend-only. | Critical | `server.ts:972-988` |
| B5 | Unbounded `state.ideas` array — no cap, grows indefinitely. | High | `server.ts:955, 536, 664` |
| B6 | Unbounded `state.edges` array — synthesizer appends without dedup or cap. | Medium | `server.ts:497-500` |
| B7 | Race condition in `broadcastUntouchedDirection` — async gap before flag is set. | Low | `server.ts:387-454` |
| B8 | `JSON.parse` on AI responses with no dedicated error handling in synthesizer. | Low | `server.ts:493` |
| B9 | Participant map keyed by socketId — reconnecting user loses history. | Medium | `server.ts:92-99` |
| B10 | `forge_artifact` with 0 ideas wastes an AI call. | Low | `server.ts:1026-1042` |

## Section 2: Backend — Audio/Video & AI Service

| # | Edge Case | Severity | Location |
|---|-----------|----------|----------|
| B11 | `triggerResearcher` accesses `response.text` without null check — `.substring()` throws. | High | `server.ts:471` |
| B12 | Anchor live session is a single global — stale session after error/reconnect. | Medium | `server.ts:204-280` |
| B13 | No timeout on Gemini API calls — hangs block `directionSuggestionInFlight` forever. | High | `server.ts:287-321, 335-385, 482-557` |
| B14 | `setInterval` agents run regardless of session state — unnecessary API calls. | Medium | `server.ts:482-557` |
| B15 | Audio chunks sent before live session promise resolves — early speech lost. | High | `server.ts:896-914` |
| B16 | No rate limiting on `audio_chunk` or `video_chunk`. | Medium | `server.ts:896-928` |
| B17 | `liveSessionPromise` race on disconnect — emits to dead socket. | Low | `server.ts:819-825, 1050-1055` |
| B18 | `text_chunk` silently dropped without active session — no user feedback. | Medium | `server.ts:880-894` |
| B19 | `getAI()` creates a new client instance on every call. | Low | `server.ts:35-44` |
| B20 | Projection matrix regenerated on restart — positions inconsistent. | Low | `server.ts:47-49` |

## Section 3: Frontend — State & UI

| # | Edge Case | Severity | Location |
|---|-----------|----------|----------|
| F1 | Duplicate voting systems with independent state in App.tsx and IdeaVoting.tsx. User gets fresh credits on phase switch. | Critical | `App.tsx:49-50`, `IdeaVoting.tsx:8-9` |
| F2 | `ideas.sort()` mutates array in-place during render. | High | `IdeaVoting.tsx:43` |
| F3 | Participant sets topic on join — overwrites admin's topic. | High | `App.tsx:529, 549` |
| F4 | No socket null-check consistency; `handleManualForge` try/catch won't catch async errors. | Medium | `App.tsx:477-487` |
| F5 | `audioContextRef` closed but never nulled — fallback references closed context. | Medium | `App.tsx:334-336, 306-308` |
| F6 | Edit panel emits `edit_idea` on every keystroke — floods server and triggers embeddings. | High | `App.tsx:811-823` |
| F7 | Selected idea removed by batch update leaves empty edit panel. | Low | `App.tsx:780-828` |
| F8 | `isForging` never resets on server error — button stays disabled forever. | High | `App.tsx:477-487, 251-255` |
| F9 | No cleanup of audioContext/mediaStream on component unmount. | Medium | `App.tsx:311-317` |
| F10 | Manual idea input only shows when there's an `audioError`. | Low | `App.tsx:738-765` |

## Section 4: Frontend — Audio Playback & 3D Rendering

| # | Edge Case | Severity | Location |
|---|-----------|----------|----------|
| F11 | `Int16Array` from potentially unaligned buffer — `RangeError` on some browsers. | High | `App.tsx:106` |
| F12 | Separate audio contexts for recording and playback — `nextPlayTimeRef` set from wrong context. | Medium | `App.tsx:144-147` |
| F13 | `activeSourcesRef` grows if `onended` doesn't fire after context close. | Low | `App.tsx:130-133` |
| F14 | `ensurePlaybackAudioContext` called without await in `requestSuggestion`. | Medium | `App.tsx:472-475` |
| F15 | 3D swarm recomputes entire graph on every 1.5s batch update. | Medium | `IdeaSwarm.tsx:175` |
| F16 | `sphereGeometry` re-created on hover — GC pressure. | Medium | `IdeaSwarm.tsx:127` |
| F17 | `Html` overlay for every node regardless of distance — DOM bloat. | Medium | `IdeaSwarm.tsx:142-158` |
| F18 | `dangerouslySetInnerHTML` with Mermaid SVG and `securityLevel: 'loose'`. | Medium | `ArtifactCanvas.tsx:175, 32` |
| F19 | Mermaid render ID not unique across re-renders of same topic. | Low | `ArtifactCanvas.tsx:54` |
| F20 | No scroll-to-zoom on artifact canvas — inconsistent with 3D swarm UX. | Low | `ArtifactCanvas.tsx:152-178` |

## Section 5: Concurrency & Multi-User

| # | Edge Case | Severity | Location |
|---|-----------|----------|----------|
| M1 | Global state shared across all sessions — no rooms/isolation. | High | `server.ts:81-88` |
| M2 | Participant overwrites another's topic mid-session. | Critical | `server.ts:931-934, App.tsx:529,549` |
| M3 | Vote weight manipulation across clients via raw socket emit. | Critical | `server.ts:972-988` |
| M4 | `edit_idea` has no ownership check. | Medium | `server.ts:991-1018` |
| M5 | Synthesizer edges reference stale or nonexistent idea IDs. | Medium | `server.ts:494-500` |
| M6 | Simulation sockets count as real participants. | Low | `simulator.ts:18-77` |
| M7 | `pendingIdeas`/`pendingUpdates` not atomic (mostly safe in Node single-thread). | Low | `server.ts:560-570` |
| M8 | Credits/votes reset on refresh — unlimited voting power. | Critical | `App.tsx:49-50, IdeaVoting.tsx:8-9` |
| M9 | No reconnection handling — stale server session, lost UI state. | Medium | `App.tsx:197-317` |
| M10 | Devil's Advocate ideas have no dedup — repeated critiques over time. | Low | `server.ts:509-557` |

---

## Severity Summary

| Severity | Count | Items |
|----------|-------|-------|
| Critical | 6 | B1, B2, B4, F1, M2, M8 |
| High | 11 | B3, B5, B11, B13, B15, F2, F3, F6, F8, F11, M1 |
| Medium | 15 | B6, B9, B12, B14, B16, B18, F4, F5, F9, F12, F14, F15, F16, F17, F18, M4, M5, M9 |
| Low | 11 | B7, B8, B10, B17, B19, B20, F7, F10, F13, F19, F20, M6, M7, M10 |

## Recommended Fix Order

### Wave 1 — Security & Data Integrity (Critical)
1. Server-side authorization for `set_topic` and `set_phase` (admin-only) — B1, B2, M2
2. Server-side vote validation with per-socket credit tracking — B4, M3, M8
3. Unify duplicate voting state between App.tsx and IdeaVoting.tsx — F1

### Wave 2 — Robustness (High)
4. Input validation and length limits on `add_idea` and `edit_idea` — B3
5. Cap `state.ideas` array with eviction — B5
6. Debounce edit panel emits — F6
7. Fix `isForging` stuck state on server error — F8
8. Fix `.sort()` mutation in IdeaVoting — F2
9. Null-check `response.text` in researcher — B11
10. Add timeouts to Gemini API calls — B13
11. Buffer early audio chunks until session ready — B15
12. Fix `Int16Array` alignment — F11
13. Prevent participants from setting topic on join — F3

### Wave 3 — Performance & UX (Medium/Low)
14. Guard intervals behind active-session check — B14
15. Debounce/throttle 3D graph recomputation — F15, F16, F17
16. Cleanup audio/video resources on unmount — F5, F9
17. Mermaid security and ID uniqueness — F18, F19
18. Remaining low-severity items
