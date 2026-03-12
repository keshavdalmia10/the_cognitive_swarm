# Repo Pattern

This repository already contains a backend-proxy Live API pattern. Reuse it when the user wants a Node backend plus browser frontend instead of a direct WebRTC client.

## Backend Pattern In `server.ts`

- The backend creates the Gemini client and opens the live session with `getAI().live.connect(...)`.
- Session config sets audio response modality, voice config, system instruction, and function declarations in one place.
- The backend forwards model audio back to the browser over Socket.IO.
- The backend handles tool calls, performs side effects, and sends `sendToolResponse(...)` back into the live session.
- Text requests use a turn-based live-session path, while microphone chunks use realtime media input.

## Frontend Pattern In `src/App.tsx`

- The browser captures microphone audio with `getUserMedia`.
- The app uses an `AudioWorklet` to emit base64 PCM chunks to the backend.
- Returned audio is decoded from PCM16, converted to float samples, and played back at 24 kHz.
- Interruption handling clears queued audio so playback does not drift after the model cuts itself off.

## Reuse Guidance

- Follow this pattern for browser apps that already have a trusted backend.
- Keep the Live API connection on the server if the app needs tool execution, rate limiting, or secret isolation.
- Mirror the split already present here: browser for capture and playback, backend for model session ownership.

## Important Caveat

- Do not reuse the current hard-coded API key pattern from `server.ts`. Move the key into an environment variable or another server-side secret store before extending this implementation.
