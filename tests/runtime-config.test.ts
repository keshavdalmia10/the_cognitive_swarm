import test from "node:test";
import assert from "node:assert/strict";

import { getDeploymentConfig, getRedisConnectionConfig } from "../src/server/runtimeConfig.ts";

test("getRedisConnectionConfig prefers REDIS_URL", () => {
  const config = getRedisConnectionConfig({
    REDIS_URL: "redis://127.0.0.1:6379",
    REDIS_HOST: "ignored-host",
    REDIS_PORT: "6380",
  } as NodeJS.ProcessEnv);

  assert.deepEqual(config, { url: "redis://127.0.0.1:6379" });
});

test("getRedisConnectionConfig builds host and port settings", () => {
  const config = getRedisConnectionConfig({
    REDIS_HOST: "10.0.0.3",
    REDIS_PORT: "6380",
    REDIS_PASSWORD: "secret",
    REDIS_TLS: "true",
  } as NodeJS.ProcessEnv);

  assert.deepEqual(config, {
    host: "10.0.0.3",
    port: 6380,
    password: "secret",
    tls: true,
  });
});

test("getDeploymentConfig requires external state in production by default", () => {
  const config = getDeploymentConfig({
    NODE_ENV: "production",
    APP_ENV: "prod",
  } as NodeJS.ProcessEnv);

  assert.equal(config.appEnv, "prod");
  assert.equal(config.requireRedis, true);
  assert.equal(config.requireFirestore, true);
  assert.equal(config.allowInMemoryState, false);
});
