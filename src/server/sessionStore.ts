import { FieldValue, Firestore } from "@google-cloud/firestore";

import { createRedisClientFromConfig, type AppRedisClient, type DeploymentConfig } from "./runtimeConfig.ts";
import {
  cloneSessionSnapshot,
  createDefaultSessionSnapshot,
  type SessionParticipant,
  type SessionSnapshot,
} from "./sessionTypes.ts";

type Mutator = (snapshot: SessionSnapshot) => void | Promise<void>;

interface StoreStatus {
  ready: boolean;
  storage: "memory" | "redis";
  durablePersistence: "firestore" | "disabled";
  details: string[];
}

export class SessionStore {
  private redisClient: AppRedisClient | null = null;
  private firestore: Firestore | null = null;
  private snapshot = createDefaultSessionSnapshot();
  private readonly mode: "memory" | "redis";

  constructor(private readonly config: DeploymentConfig) {
    this.mode = config.redis ? "redis" : "memory";
  }

  async init() {
    if (this.config.redis) {
      const client = createRedisClientFromConfig(this.config.redis);
      client.on("error", (error) => {
        console.error("Redis client error:", error);
      });
      await client.connect();
      this.redisClient = client;
      this.snapshot = await this.readSnapshotFromRedis();
    }

    const shouldUseFirestore =
      this.config.requireFirestore ||
      Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
      Boolean(process.env.GOOGLE_CLOUD_PROJECT);

    if (shouldUseFirestore && process.env.FIRESTORE_DISABLED !== "true") {
      try {
        this.firestore = new Firestore();
      } catch (error) {
        console.error("Failed to initialize Firestore client:", error);
      }
    }

    await this.hydrateFromDurableSnapshotIfNeeded();
  }

  async close() {
    if (this.redisClient?.isOpen) {
      await this.redisClient.quit();
    }
  }

  getRedisClient() {
    return this.redisClient;
  }

  getStatus(): StoreStatus {
    const details: string[] = [];

    if (this.mode === "memory") {
      details.push("Redis is not configured; using in-memory session state.");
    } else if (!this.redisClient?.isReady) {
      details.push("Redis client is not connected.");
    }

    if (this.firestore) {
      details.push("Firestore durability is enabled.");
    } else {
      details.push("Firestore durability is disabled.");
    }

    const redisReady = this.mode === "memory" ? this.config.allowInMemoryState : Boolean(this.redisClient?.isReady);
    const firestoreReady = this.firestore ? true : !this.config.requireFirestore;

    return {
      ready: redisReady && firestoreReady,
      storage: this.mode,
      durablePersistence: this.firestore ? "firestore" : "disabled",
      details,
    };
  }

  async getSnapshot(): Promise<SessionSnapshot> {
    if (!this.redisClient) {
      return cloneSessionSnapshot(this.snapshot);
    }

    this.snapshot = await this.readSnapshotFromRedis();
    return cloneSessionSnapshot(this.snapshot);
  }

  async mutate(mutator: Mutator): Promise<SessionSnapshot> {
    if (!this.redisClient) {
      const nextSnapshot = cloneSessionSnapshot(this.snapshot);
      await mutator(nextSnapshot);
      nextSnapshot.metadata.updatedAt = Date.now();
      this.snapshot = nextSnapshot;
      await this.persistSnapshot(nextSnapshot);
      return cloneSessionSnapshot(nextSnapshot);
    }

    const stateKey = this.getStateKey();
    const participantsKey = this.getParticipantsKey();
    const metadataKey = this.getMetadataKey();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.redisClient.watch([stateKey, participantsKey, metadataKey]);

      const currentSnapshot = await this.readSnapshotFromRedis();
      const nextSnapshot = cloneSessionSnapshot(currentSnapshot);
      await mutator(nextSnapshot);
      nextSnapshot.metadata.updatedAt = Date.now();

      const result = await this.redisClient
        .multi()
        .set(stateKey, JSON.stringify(nextSnapshot.state))
        .set(participantsKey, JSON.stringify(nextSnapshot.participants))
        .set(metadataKey, JSON.stringify(nextSnapshot.metadata))
        .exec();

      if (result) {
        this.snapshot = nextSnapshot;
        await this.persistSnapshot(nextSnapshot);
        return cloneSessionSnapshot(nextSnapshot);
      }
    }

    throw new Error("Failed to update shared session state after multiple retries.");
  }

  async removeParticipant(socketId: string): Promise<SessionSnapshot> {
    return this.mutate((snapshot) => {
      delete snapshot.participants[socketId];
    });
  }

  private async hydrateFromDurableSnapshotIfNeeded() {
    const hasActiveState =
      this.snapshot.state.ideas.length > 0 ||
      Object.keys(this.snapshot.participants).length > 0 ||
      Boolean(this.snapshot.state.topic);

    if (hasActiveState || !this.firestore) {
      return;
    }

    const storedSnapshot = await this.loadDurableSnapshot();
    if (!storedSnapshot) {
      await this.persistSnapshot(this.snapshot);
      return;
    }

    this.snapshot = storedSnapshot;
    if (!this.redisClient) {
      return;
    }

    await this.redisClient
      .multi()
      .set(this.getStateKey(), JSON.stringify(storedSnapshot.state))
      .set(this.getParticipantsKey(), JSON.stringify(storedSnapshot.participants))
      .set(this.getMetadataKey(), JSON.stringify(storedSnapshot.metadata))
      .exec();
  }

  private async persistSnapshot(snapshot: SessionSnapshot) {
    if (!this.firestore) {
      return;
    }

    await this.firestore.collection(this.config.fireStoreCollection).doc(this.config.roomId).set(
      {
        appEnv: this.config.appEnv,
        snapshot,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  private async loadDurableSnapshot(): Promise<SessionSnapshot | null> {
    if (!this.firestore) {
      return null;
    }

    const document = await this.firestore.collection(this.config.fireStoreCollection).doc(this.config.roomId).get();
    if (!document.exists) {
      return null;
    }

    const data = document.data();
    const snapshot = data?.snapshot as SessionSnapshot | undefined;
    if (!snapshot?.state || !snapshot?.participants || !snapshot?.metadata) {
      return null;
    }

    return snapshot;
  }

  private async readSnapshotFromRedis(): Promise<SessionSnapshot> {
    if (!this.redisClient) {
      return cloneSessionSnapshot(this.snapshot);
    }

    const values = await this.redisClient.mGet([
      this.getStateKey(),
      this.getParticipantsKey(),
      this.getMetadataKey(),
    ]);

    const [stateRaw, participantsRaw, metadataRaw] = values as Array<string | null>;
    if (!stateRaw || !participantsRaw || !metadataRaw) {
      const emptySnapshot = createDefaultSessionSnapshot();
      await this.redisClient
        .multi()
        .set(this.getStateKey(), JSON.stringify(emptySnapshot.state))
        .set(this.getParticipantsKey(), JSON.stringify(emptySnapshot.participants))
        .set(this.getMetadataKey(), JSON.stringify(emptySnapshot.metadata))
        .exec();
      return emptySnapshot;
    }

    return {
      state: JSON.parse(stateRaw),
      participants: JSON.parse(participantsRaw) as Record<string, SessionParticipant>,
      metadata: JSON.parse(metadataRaw),
    };
  }

  private getBaseKey() {
    return `cognitive-swarm:${this.config.appEnv}:${this.config.roomId}`;
  }

  private getStateKey() {
    return `${this.getBaseKey()}:state`;
  }

  private getParticipantsKey() {
    return `${this.getBaseKey()}:participants`;
  }

  private getMetadataKey() {
    return `${this.getBaseKey()}:metadata`;
  }
}
