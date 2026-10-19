import { NextResponse } from "next/server";
import { issueAdminSession, checkAdminPassword } from "@/lib/adminAuth";
import { jsonFail } from "@/lib/apiResponse";
import { isAdminConfigured } from "@/lib/config";
import { isSameOrigin, readJsonBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * Very small in-memory throttle so a local deployment is not trivially
 * brute-forceable. Resets on restart (deliberately dependency free).
 */
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; firstAt: number }>();

function registerAttempt(key: string): { blocked: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return { blocked: false, retryAfterSeconds: 0 };
  }

  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((WINDOW_MS - (now - entry.firstAt)) / 1000);
    return { blocked: true, retryAfterSeconds };
  }
  return { blocked: false, retryAfterSeconds: 0 };
}

/** POST /api/admin/login  { password } */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return jsonFail("FORBIDDEN", "Cross-site requests are not allowed.", 403);
  }

  if (!isAdminConfigured()) {
    return jsonFail(
      "CONFIG_ERROR",
      "Admin access is disabled because ADMIN_PASSWORD is not set in .env.local.",
      503,
    );
  }

  const clientKey =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  const throttle = registerAttempt(clientKey);
  if (throttle.blocked) {
    return NextResponse.json(
      {
        success: false,
        error: "RATE_LIMITED",
        message: `Too many failed attempts. Try again in ${throttle.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return jsonFail("VALIDATION_ERROR", body.message, 400);
  }

  const password = (body.value as { password?: unknown }).password;
  if (!checkAdminPassword(password)) {
    return jsonFail("UNAUTHORIZED", "Incorrect admin password.", 401);
  }

  attempts.delete(clientKey);
  const ttlMs = await issueAdminSession();
  return NextResponse.json({ success: true, expiresInMs: ttlMs });
}
