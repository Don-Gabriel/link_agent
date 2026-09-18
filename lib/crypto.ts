/**
 * Token encryption at rest (AES-256-GCM).
 *
 * A LinkedIn access token IS the ability to post as you for the next 60 days.
 * Neon backups, a leaked connection string, or a shared read-replica should
 * not hand that over, so tokens are encrypted before they touch a column and
 * decrypted only in the request that needs them.
 *
 * Unlike the external-service clients in this codebase, these functions THROW
 * on misconfiguration. A missing or malformed key is an operator error that
 * must be loud at connect time, not a degraded mode that silently writes
 * plaintext credentials.
 *
 * Generate a key with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;
const PREFIX = "v1:";

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set — refusing to store a LinkedIn token. " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  // Accept base64 or hex; both are natural things to paste into a .env.
  const buf = /^[0-9a-f]{64}$/i.test(raw.trim())
    ? Buffer.from(raw.trim(), "hex")
    : Buffer.from(raw.trim(), "base64");
  if (buf.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). Use a fresh base64 32-byte key.`,
    );
  }
  return buf;
}

/** True if a usable key is configured — for honest status reporting, never for control flow around storage. */
export function hasEncryptionKey(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encrypt(plaintext: string, context?: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  if (context) cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(payload: string, context?: string): string {
  if (!payload.startsWith(PREFIX)) {
    throw new Error("ciphertext is not in the expected v1 format");
  }
  const buf = Buffer.from(payload.slice(PREFIX.length), "base64");
  if (buf.length <= IV_BYTES + TAG_BYTES) throw new Error("ciphertext is truncated");
  const decipher = createDecipheriv(ALGO, key(), buf.subarray(0, IV_BYTES));
  if (context) decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}
