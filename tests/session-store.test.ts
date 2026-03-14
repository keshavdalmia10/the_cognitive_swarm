import test from "node:test";
import assert from "node:assert/strict";

import { SessionStore } from "../src/server/sessionStore.ts";
import type { DeploymentConfig } from "../src/server/runtimeConfig.ts";

const baseConfig: DeploymentConfig = {
  appEnv: "test",
  roomId: "main-room",
  fireStoreCollection: "test_sessions",
  redis: null,
  requireRedis: false,
  requireFirestore: false,
  allowInMemoryState: true,
};

test("SessionStore supports in-memory mutation and participant cleanup", async () => {
  const previousFirestoreDisabled = process.env.FIRESTORE_DISABLED;
  process.env.FIRESTORE_DISABLED = "true";

  const store = new SessionStore(baseConfig);
  await store.init();

  await store.mutate((snapshot) => {
    snapshot.state.topic = "Durable swarm";
    snapshot.participants["socket-1"] = {
      socketId: "socket-1",
      userName: "Alex",
      role: "admin",
      joinedAt: 1,
      contributionCount: 2,
      lastContributionAt: 2,
      credits: 99,
      votes: {},
    };
  });

  let snapshot = await store.getSnapshot();
  assert.equal(snapshot.state.topic, "Durable swarm");
  assert.equal(snapshot.participants["socket-1"]?.userName, "Alex");

  snapshot = await store.removeParticipant("socket-1");
  assert.equal(snapshot.participants["socket-1"], undefined);

  if (previousFirestoreDisabled === undefined) {
    delete process.env.FIRESTORE_DISABLED;
  } else {
    process.env.FIRESTORE_DISABLED = previousFirestoreDisabled;
  }
});
