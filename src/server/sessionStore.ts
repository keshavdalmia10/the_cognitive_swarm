import type { Firestore } from "@google-cloud/firestore";

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

interface SessionStoreOptions {
  createIfMissing?: boolean;
  firestore?: Firestore | null;
}

interface RedisReadResult {
  exists: boolean;
  snapshot: SessionSnapshot;
}

let firestoreModulePromise: Promise<typeof import("@google-cloud/firestore")> | null = null;

async function getFirestoreModule() {
  if (!firestoreModulePromise) {
    firestoreModulePromise = import("@google-cloud/firestore");
  }

  return firestoreModulePromise;
}

async function createFirestoreClient() {
  const { Firestore } = await getFirestoreModule();
  return new Firestore();
}

export class SessionStore {
  private redisClient: AppRedisClient | null = null;
  private firestore: Firestore | null = null;
  private snapshot = createDefaultSessionSnapshot(this.config.roomId);
  private readonly mode: "memory" | "redis";
  private readonly createIfMissing: boolean;
  private readonly sharedFirestore: Firestore | null;
  private readonly ownsFirestore: boolean;
  private exists = false;

  constructor(
    private readonly config: DeploymentConfig,
    options: SessionStoreOptions = {},
  ) {
    this.mode = config.redis ? "redis" : "memory";
    this.createIfMissing = options.createIfMissing ?? true;
    this.sharedFirestore = options.firestore ?? null;
    this.ownsFirestore = !this.sharedFirestore;
  }

  async init() {
    if (this.config.redis) {
      const client = await createRedisClientFromConfig(this.config.redis);
      client.on("error", (error) => {
        console.error("Redis client error:", error);
      });
      await client.connect();
      this.redisClient = client;
      const redisResult = await this.readSnapshotFromRedis();
      this.snapshot = redisResult.snapshot;
      this.exists = redisResult.exists;
    } else {
      this.snapshot = createDefaultSessionSnapshot(this.config.roomId);
      this.exists = this.createIfMissing;
    }

    const shouldUseFirestore =
      this.config.requireFirestore ||
      Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
      Boolean(process.env.GOOGLE_CLOUD_PROJECT);

    if (this.sharedFirestore) {
      this.firestore = this.sharedFirestore;
    } else if (shouldUseFirestore && process.env.FIRESTORE_DISABLED !== "true") {
      try {
        this.firestore = await createFirestoreClient();
      } catch (error) {
        console.error("Failed to initialize Firestore client:", error);
      }
    }

    const hydrated = await this.hydrateFromDurableSnapshotIfNeeded();
    if (hydrated) {
      this.exists = true;
    }

    if (!this.exists && this.createIfMissing) {
      this.snapshot = createDefaultSessionSnapshot(this.config.roomId);
      this.exists = true;
      await this.writeSnapshot(this.snapshot);
      await this.persistSnapshot(this.snapshot);
    }
  }

  async close() {
    if (this.redisClient?.isOpen) {
      await this.redisClient.quit();
    }
  }

  existsInStore() {
    return this.exists;
  }

  getRoomCode() {
    return this.config.roomId;
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

    const redisResult = await this.readSnapshotFromRedis();
    this.snapshot = redisResult.snapshot;
    this.exists = redisResult.exists;
    return cloneSessionSnapshot(this.snapshot);
  }

  async mutate(mutator: Mutator): Promise<SessionSnapshot> {
    if (!this.exists && !this.createIfMissing) {
      throw new Error(`Room ${this.config.roomId} does not exist.`);
    }

    if (!this.redisClient) {
      const nextSnapshot = cloneSessionSnapshot(this.snapshot);
      await mutator(nextSnapshot);
      const now = Date.now();
      nextSnapshot.metadata.updatedAt = now;
      nextSnapshot.room.updatedAt = now;
      this.snapshot = nextSnapshot;
      this.exists = true;
      await this.persistSnapshot(nextSnapshot);
      return cloneSessionSnapshot(nextSnapshot);
    }

    const stateKey = this.getStateKey();
    const participantsKey = this.getParticipantsKey();
    const metadataKey = this.getMetadataKey();
    const roomKey = this.getRoomKey();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.redisClient.watch([stateKey, participantsKey, metadataKey, roomKey]);

      const currentSnapshot = await this.readSnapshotFromRedis();
      if (!currentSnapshot.exists && !this.createIfMissing) {
        await this.redisClient.unwatch();
        throw new Error(`Room ${this.config.roomId} does not exist.`);
      }

      const nextSnapshot = cloneSessionSnapshot(currentSnapshot.snapshot);
      await mutator(nextSnapshot);
      const now = Date.now();
      nextSnapshot.metadata.updatedAt = now;
      nextSnapshot.room.updatedAt = now;

      const result = await this.redisClient
        .multi()
        .set(stateKey, JSON.stringify(nextSnapshot.state))
        .set(participantsKey, JSON.stringify(nextSnapshot.participants))
        .set(metadataKey, JSON.stringify(nextSnapshot.metadata))
        .set(roomKey, JSON.stringify(nextSnapshot.room))
        .exec();

      if (result) {
        this.snapshot = nextSnapshot;
        this.exists = true;
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
      this.exists ||
      this.snapshot.state.ideas.length > 0 ||
      Object.keys(this.snapshot.participants).length > 0 ||
      Boolean(this.snapshot.state.topic);

    if (hasActiveState || !this.firestore) {
      return false;
    }

    const storedSnapshot = await this.loadDurableSnapshot();
    if (!storedSnapshot) {
      return false;
    }

    this.snapshot = storedSnapshot;
    if (this.redisClient) {
      await this.writeSnapshot(storedSnapshot);
    }
    return true;
  }

  private async writeSnapshot(snapshot: SessionSnapshot) {
    if (!this.redisClient) {
      return;
    }

    await this.redisClient
      .multi()
      .set(this.getStateKey(), JSON.stringify(snapshot.state))
      .set(this.getParticipantsKey(), JSON.stringify(snapshot.participants))
      .set(this.getMetadataKey(), JSON.stringify(snapshot.metadata))
      .set(this.getRoomKey(), JSON.stringify(snapshot.room))
      .exec();
  }

  private async persistSnapshot(snapshot: SessionSnapshot) {
    if (!this.firestore) {
      return;
    }

    const { FieldValue } = await getFirestoreModule();

    await this.firestore.collection(this.config.fireStoreCollection).doc(this.config.roomId).set(
      {
        appEnv: this.config.appEnv,
        roomCode: this.config.roomId,
        status: snapshot.room.status,
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
    if (!snapshot?.state || !snapshot?.participants || !snapshot?.metadata || !snapshot?.room) {
      return null;
    }

    return snapshot;
  }

  private async readSnapshotFromRedis(): Promise<RedisReadResult> {
    if (!this.redisClient) {
      return {
        exists: this.exists,
        snapshot: cloneSessionSnapshot(this.snapshot),
      };
    }

    const values = await this.redisClient.mGet([
      this.getStateKey(),
      this.getParticipantsKey(),
      this.getMetadataKey(),
      this.getRoomKey(),
    ]);

    const [stateRaw, participantsRaw, metadataRaw, roomRaw] = values as Array<string | null>;
    if (!stateRaw || !participantsRaw || !metadataRaw) {
      return {
        exists: false,
        snapshot: createDefaultSessionSnapshot(this.config.roomId),
      };
    }

    const snapshot = createDefaultSessionSnapshot(this.config.roomId);
    snapshot.state = JSON.parse(stateRaw);
    snapshot.participants = JSON.parse(participantsRaw) as Record<string, SessionParticipant>;
    snapshot.metadata = JSON.parse(metadataRaw);
    snapshot.room = roomRaw ? JSON.parse(roomRaw) : snapshot.room;

    return {
      exists: true,
      snapshot,
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

  private getRoomKey() {
    return `${this.getBaseKey()}:room`;
  }
}
