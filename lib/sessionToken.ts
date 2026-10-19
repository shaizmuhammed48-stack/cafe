/**
 * Stateless, HMAC-signed admin session tokens.
 *
 * Implemented with Web Crypto only so the exact same module works in the Edge
 * middleware and in the Node.js route handlers.
 *
 * Token format: base64url(payload).base64url(hmacSha256(secret, payload))
 * Payload:      { sub: "admin", exp: <unix ms> }
 */

export const ADMIN_COOKIE_NAME = "madco_admin_session";

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface SessionPayload {
  sub: "admin";
  exp: number;
}

export async function createSessionToken(secret: string, ttlMs: number): Promise<string> {
  const payload: SessionPayload = { sub: "admin", exp: Date.now() + ttlMs };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySessionToken(
  secret: string,
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, encodedSignature] = parts;
  try {
    const key = await importKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as unknown;
    if (typeof payload !== "object" || payload === null) return null;
    const { sub, exp } = payload as Partial<SessionPayload>;
    if (sub !== "admin") return null;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp < Date.now()) return null;

    return { sub: "admin", exp };
  } catch {
    return null;
  }
}

/** Constant-time-ish comparison for the admin password. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
