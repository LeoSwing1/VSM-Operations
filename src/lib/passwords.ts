import { randomInt } from "node:crypto";

/** Readable temporary password: no look-alike characters, 4 groups, ~70 bits. Shown once, then must be changed. */
export function temporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const group = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${group()}-${group()}-${group()}-${randomInt(10, 99)}`;
}
