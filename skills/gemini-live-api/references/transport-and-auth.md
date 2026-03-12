# Transport And Auth

Use this file first. Most Gemini Live API mistakes come from choosing the wrong transport or putting credentials on the wrong side of the boundary.

## Decision Guide

- Use a backend-held WebSocket or SDK session when the server can own the API key and stream text, audio, or video on behalf of clients.
- Use WebRTC when the product is browser-first or mobile-first and needs low-latency microphone, camera, and speaker handling directly in the client.
- Use a backend proxy even for browser apps when tool execution, audit logging, moderation, or policy enforcement matters more than shaving every millisecond.

## Auth Rules

- Keep the long-lived Gemini API key on the server.
- For direct client connections, mint a short-lived ephemeral credential from a backend endpoint instead of shipping the API key to the browser.
- Treat token minting flow, model names, and preview capabilities as version-sensitive. Re-check official Google docs before coding them from memory.

## Session Setup Checklist

- Choose the model and confirm it is currently supported for Live API usage.
- Set response modalities explicitly instead of assuming defaults.
- Define voice or speech config only if the app needs native audio output.
- Declare tools up front when the model should call functions during the live session.
- Write the system instruction around the live turn loop, not around one-shot `generateContent` behavior.
- Decide whether reconnect or session resumption is required before designing the client lifecycle.

## Practical Defaults

- Default to backend-owned sessions for internal tools, web apps with a server, and anything that needs deterministic function execution.
- Default to WebRTC plus ephemeral credentials for direct browser voice or video assistants.
- Default to a plain text or audio-only path before layering in camera, screen share, or tool orchestration.
