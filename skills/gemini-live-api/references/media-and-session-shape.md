# Media And Session Shape

Use this file when the request involves microphone input, speaker playback, camera frames, or the live session event loop.

## Input Paths

- Send ordinary conversational text as live-session client turns.
- Send microphone and camera data as realtime media input with an explicit MIME type.
- Do not mix turn-based text helpers and realtime media helpers interchangeably. Pick the method that matches the payload shape.

## Audio Rules

- Keep capture format explicit. A common working browser pattern is PCM16 mono input at 16 kHz for upstream audio chunks.
- Keep playback format explicit. Native audio responses are commonly handled as 16-bit PCM at 24 kHz, which means the client usually needs to decode Int16 data and create a playback buffer at 24000 Hz.
- Make any resampling or PCM-to-float conversion visible in code.
- When the model interrupts, clear queued playback and reset any client-side playhead state.

## Video And Screen Share

- Send frames at a deliberate cadence instead of pushing every possible frame.
- Keep frame encoding and MIME type explicit so the sender and receiver agree on shape.
- If the client owns camera and speaker devices directly, prefer a WebRTC-oriented architecture unless there is a clear reason not to.

## Session Lifecycle

- Handle open, message, close, and error events explicitly.
- Treat interruption as a normal state transition, not as an exception.
- Close the live session when no media or turn stream still needs it.
- Add reconnect or resume logic only when the product actually needs continuity across transient disconnects.

## Configuration Checklist

- Set `responseModalities` deliberately.
- Add voice config only when audio output matters.
- Keep system instruction short enough to guide the realtime loop without overwhelming each turn.
- Separate transport-level errors, model errors, and media-device errors in logs and UI.
