# The Cognitive Swarm

The Cognitive Swarm is a real-time, multimodal brainstorming application built with React, Socket.IO, Express, Vite, and the Gemini API. Participants join a shared session, speak ideas into the room, vote on them, explore them in a 3D swarm, and forge the discussion into a Mermaid artifact.

The app uses Gemini in two ways:
- Gemini Live for low-latency voice interaction with the anchor.
- Gemini model calls for idea research, connection synthesis, artifact generation, and embeddings.

## Core Capabilities

- Real-time shared brainstorm state over Socket.IO
- Live anchor voice that can answer, joke lightly, praise contributors, and invite quieter participants in
- Audio and video streaming into Gemini Live
- Automatic idea extraction and clustering
- 3D idea swarm visualization
- Quadratic voting during convergence
- Topic-aware Mermaid artifact generation during forging

## Architecture

Detailed architecture, runtime flow, and Gemini integration notes live in [docs/architecture.md](docs/architecture.md).

## Run Locally

### Prerequisites

- Node.js 20+
- npm
- A valid Gemini API key
- A browser that supports microphone access

### Setup

1. Install dependencies:

```bash
npm install
```

2. Create a local environment file from the example:

```bash
cp .env.example .env
```

3. Set your Gemini key in `.env`:

```bash
GEMINI_API_KEY="your-gemini-api-key"
```

4. Optional: change the port if needed:

```bash
PORT=3001
```

### Start the app

```bash
npm run dev
```

Open the app in your browser at `http://127.0.0.1:3001` unless you set a different `PORT`.

### Verification

Run the checks:

```bash
npm test
npm run lint
```

Check server health:

```bash
curl http://127.0.0.1:3001/api/health
```

Expected response:

```json
{"status":"ok"}
```

## Runtime Notes

- `npm run dev` starts the Express + Socket.IO server from `server.ts`.
- In development, the server mounts Vite middleware directly, so one process serves both the API/socket layer and the frontend.
- The browser will prompt for microphone permission when a participant joins audio.
- Camera streaming is optional and currently sends roughly one JPEG frame per second into the live Gemini session.
