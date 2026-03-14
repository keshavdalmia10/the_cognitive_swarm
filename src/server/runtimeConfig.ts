import { createClient } from "redis";

export interface RedisConnectionConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  tls?: boolean;
}

export interface DeploymentConfig {
  appEnv: string;
  roomId: string;
  fireStoreCollection: string;
  redis: RedisConnectionConfig | null;
  requireRedis: boolean;
  requireFirestore: boolean;
  allowInMemoryState: boolean;
}

export type AppRedisClient = ReturnType<typeof createClient>;

export function getRedisConnectionConfig(env: NodeJS.ProcessEnv = process.env): RedisConnectionConfig | null {
  if (env.REDIS_URL?.trim()) {
    return { url: env.REDIS_URL.trim() };
  }

  if (!env.REDIS_HOST?.trim()) {
    return null;
  }

  const parsedPort = Number(env.REDIS_PORT || 6379);
  return {
    host: env.REDIS_HOST.trim(),
    port: Number.isFinite(parsedPort) ? parsedPort : 6379,
    password: env.REDIS_PASSWORD?.trim() || undefined,
    tls: env.REDIS_TLS === "true",
  };
}

export function getDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  const appEnv = env.APP_ENV?.trim() || env.NODE_ENV?.trim() || "development";
  const redis = getRedisConnectionConfig(env);
  const allowInMemoryState = env.ALLOW_IN_MEMORY_STATE === "true" || env.NODE_ENV !== "production";
  const requireRedis = env.REQUIRE_REDIS === "true" || (env.NODE_ENV === "production" && !allowInMemoryState);
  const requireFirestore =
    env.REQUIRE_FIRESTORE === "true" ||
    (env.NODE_ENV === "production" && env.FIRESTORE_DISABLED !== "true");

  return {
    appEnv,
    roomId: env.DEFAULT_ROOM_ID?.trim() || "main-room",
    fireStoreCollection: env.FIRESTORE_COLLECTION?.trim() || "cognitive_swarm_sessions",
    redis,
    requireRedis,
    requireFirestore,
    allowInMemoryState,
  };
}

export function createRedisClientFromConfig(config: RedisConnectionConfig) {
  if (config.url) {
    return createClient({ url: config.url });
  }

  const socket = config.tls
    ? { host: config.host, port: config.port, tls: true as const }
    : { host: config.host, port: config.port };

  return createClient({
    socket: socket as any,
    password: config.password,
  });
}
