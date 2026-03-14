import test from "node:test";
import assert from "node:assert/strict";

import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "../src/server/roomCode.ts";

test("normalizeRoomCode trims and uppercases input", () => {
  assert.equal(normalizeRoomCode(" ab12cd "), "AB12CD");
});

test("isValidRoomCode accepts six-character uppercase room codes", () => {
  assert.equal(isValidRoomCode("AB12CD"), true);
  assert.equal(isValidRoomCode("ab12cd"), true);
  assert.equal(isValidRoomCode("ABC1234"), false);
  assert.equal(isValidRoomCode("AB-123"), false);
});

test("generateRoomCode returns a valid room code", () => {
  const roomCode = generateRoomCode();

  assert.equal(roomCode.length, 6);
  assert.equal(isValidRoomCode(roomCode), true);
});
