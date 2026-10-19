import { cookies } from "next/headers";
import {
  getAdminPassword,
  getSessionSecret,
  getSessionTtlMs,
  isAdminConfigured,
} from "./config";
import {
  ADMIN_COOKIE_NAME,
  createSessionToken,
  safeEqual,
  verifySessionToken,
} from "./sessionToken";

function cookieFlags(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function isAdminAuthenticated(): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  try {
    const store = await cookies();
    const token = store.get(ADMIN_COOKIE_NAME)?.value;
    const payload = await verifySessionToken(getSessionSecret(), token);
    return payload !== null;
  } catch {
    return false;
  }
}

export function checkAdminPassword(candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  if (!isAdminConfigured()) return false;
  try {
    return safeEqual(candidate, getAdminPassword());
  } catch {
    return false;
  }
}

export async function issueAdminSession(): Promise<number> {
  const ttlMs = getSessionTtlMs();
  const token = await createSessionToken(getSessionSecret(), ttlMs);
  const store = await cookies();
  store.set(ADMIN_COOKIE_NAME, token, cookieFlags(Math.floor(ttlMs / 1000)));
  return ttlMs;
}

export async function destroyAdminSession(): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_COOKIE_NAME, "", cookieFlags(0));
}
