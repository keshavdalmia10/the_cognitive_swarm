---
name: gemini-live-api
description: Plan, implement, debug, or review Gemini Live API integrations for realtime voice, video, screen-share, and tool-calling apps using the Google Gen AI SDK, WebSocket, or WebRTC transports. Use when working from the Gemini Live API docs or when building session lifecycle, authentication, ephemeral-token flows, audio or video streaming, native audio output, function calling, grounding, or interruption and resumption behavior.
---

# Gemini Live API

## Overview

Use this skill to turn Gemini Live API requirements into a concrete architecture, implementation plan, or code change. Choose the transport and auth boundary first, then load only the reference file that matches the requested interaction pattern.

## Start With The Right Reference

- Read `references/transport-and-auth.md` first for every task.
- Read `references/media-and-session-shape.md` when the request involves microphone input, speaker output, camera frames, screen share, or session configuration.
- Read `references/tools-and-control-flow.md` when the request involves function calling, tool responses, grounding, or conversation orchestration.
- Read `references/repo-pattern.md` when the project already uses `@google/genai` or when a local example is more useful than a blank-sheet implementation.

## Workflow

1. Identify the architecture.
- Decide whether the app is server-to-server, backend-mediated browser or mobile, or direct client media via WebRTC.
- Find where credentials live and move long-lived secrets off the client if needed.

2. Inspect the existing code before proposing changes.
- Search for `@google/genai`, `live.connect`, `sendRealtimeInput`, `sendClientContent`, `responseModalities`, `toolCall`, `sendToolResponse`, `getUserMedia`, and audio sample-rate handling.
- Map the current session lifecycle: connect, stream input, receive output, interrupt, tool call, close, reconnect.

3. Lock down the session contract.
- Pick the model, modalities, voice or output behavior, tool declarations, system instruction, and media formats before editing code.
- Treat model names and preview suffixes as volatile; re-check official Google docs at implementation time.

4. Implement the narrowest viable change.
- Keep transport semantics intact.
- Keep audio and video encoding assumptions explicit in code.
- Put tool execution on the backend unless the user explicitly wants client-only experimentation.

5. Verify end to end.
- Confirm connection opens cleanly.
- Confirm user input reaches the model in the expected format.
- Confirm model output is decoded and rendered correctly.
- Confirm interruption, close, and error paths are handled.
- Confirm tool responses unblock the model turn.

## Implementation Rules

- Prefer official Google docs for anything version-sensitive: model names, preview suffixes, WebRTC setup details, ephemeral-token mechanics, and supported tools.
- Never hard-code a long-lived API key into shipped client code.
- Keep text turns and realtime media paths separate; use the SDK method that matches the payload shape.
- Make audio sample rates, PCM conversion, and output playback format explicit instead of relying on implicit browser behavior.
- If the app mixes text and live media, document which path sends which content and when `turnComplete` is expected.
- When adding tools, keep schemas tight, return structured results, and wire the full request and response loop.
- If latency matters, treat buffering, interruption, and reconnect or resume behavior as product requirements rather than cleanup work.

## Deliverables

- Produce a short architecture summary before or alongside code changes.
- Call out auth boundary, transport choice, media formats, session lifecycle, tool loop, and failure handling.
- If the project already has a Live API implementation, explain whether you are aligning it to official patterns or intentionally deviating.
