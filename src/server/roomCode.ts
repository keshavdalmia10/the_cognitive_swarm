const ROOM_CODE_LENGTH = 6;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase();
}

export function isValidRoomCode(value: string) {
  return /^[A-Z0-9]{6}$/.test(normalizeRoomCode(value));
}

export function generateRoomCode() {
  let code = "";

  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }

  return code;
}
