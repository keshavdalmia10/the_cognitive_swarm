import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

import { io as createClient, type Socket } from "socket.io-client";

function waitForEvent<T>(socket: Socket, eventName: string, timeoutMs = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off(eventName, onEvent);
    };

    const onEvent = (payload: T) => {
      cleanup();
      resolve(payload);
    };

    socket.on(eventName, onEvent);
  });
}

async function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to reserve a port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForServer(baseUrl: string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(`${baseUrl}/api/health`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
    });

    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function connectClient(baseUrl: string) {
  const socket = createClient(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });

  return socket;
}

test("forging auto-refreshes after weight changes and keeps highest-weight ideas first", async () => {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverLogs = "";

  const child = spawn(process.execPath, ["--import=tsx", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      FIRESTORE_DISABLED: "true",
      ALLOW_IN_MEMORY_STATE: "true",
      FORCE_FALLBACK_ARTIFACT: "true",
      DISABLE_VITE_DEV_SERVER: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    serverLogs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    serverLogs += chunk.toString();
  });

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  let admin: Socket | null = null;
  let participant: Socket | null = null;

  try {
    await waitForServer(baseUrl);
    admin = await connectClient(baseUrl);
    participant = await connectClient(baseUrl);

    const roomCreatedPromise = waitForEvent<{ roomCode: string }>(admin, "room_created");
    const adminStateSyncPromise = waitForEvent<any>(admin, "state_sync");
    admin.emit("create_room", { userName: "Admin", topic: "Workflow prioritization" });
    const { roomCode } = await roomCreatedPromise;
    await adminStateSyncPromise;

    const participantJoinedPromise = waitForEvent<any>(participant, "room_joined");
    const participantStateSyncPromise = waitForEvent<any>(participant, "state_sync");
    participant.emit("join_room", { roomCode, userName: "Participant" });
    await participantJoinedPromise;
    await participantStateSyncPromise;

    const firstIdeaAdded = waitForEvent<Array<{ id: string }>>(admin, "ideas_batch_added");
    admin.emit("add_idea", { id: "idea-low", text: "Lower priority idea", cluster: "General" });
    await firstIdeaAdded;

    const secondIdeaAdded = waitForEvent<Array<{ id: string }>>(admin, "ideas_batch_added");
    admin.emit("add_idea", { id: "idea-high", text: "Higher priority idea", cluster: "General" });
    await secondIdeaAdded;

    const phaseChanged = waitForEvent<string>(admin, "phase_changed");
    admin.emit("set_phase", "forging");
    assert.equal(await phaseChanged, "forging");

    const weightUpdated = waitForEvent<{ ideaId: string; weight: number }>(participant, "idea_weight_updated");
    const artifactUpdated = waitForEvent<{ title: string; mermaid: string }>(participant, "artifact_updated", 6000);
    participant.emit("update_idea_weight", { ideaId: "idea-high", weightChange: 1 });

    const weightPayload = await weightUpdated;
    assert.equal(weightPayload.ideaId, "idea-high");
    assert.equal(weightPayload.weight, 2);

    const artifact = await artifactUpdated;
    assert.equal(artifact.title, "Workflow prioritization");
    assert.ok(
      artifact.mermaid.indexOf("Higher priority idea") >= 0,
      `Expected artifact to include higher-weight idea.\nLogs:\n${serverLogs}`,
    );
    assert.ok(
      artifact.mermaid.indexOf("Higher priority idea") < artifact.mermaid.indexOf("Lower priority idea"),
      `Expected higher-weight idea to appear before lower-weight idea.\nArtifact:\n${artifact.mermaid}\nLogs:\n${serverLogs}`,
    );
  } finally {
    admin?.disconnect();
    participant?.disconnect();
    child.kill("SIGTERM");
    const exit = await exitPromise;
    assert.ok(
      exit.code === 0 || exit.signal === "SIGTERM",
      `Server did not shut down cleanly.\nLogs:\n${serverLogs}`,
    );
  }
});
