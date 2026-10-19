/**
 * Consistent JSON responses + error mapping for the Next.js API routes.
 *
 * Every route answers with one of:
 *   success → { success: true, ...payload }
 *   failure → { success: false, error, message, details? }
 */

import { NextResponse } from "next/server";
import { ScriptError } from "./appsScript";
import { ApiError } from "./api";
import type { ApiFailure } from "./types";

export function jsonOk<T extends Record<string, unknown>>(payload: T, status = 200) {
  return NextResponse.json({ success: true as const, ...payload }, { status });
}

export function jsonFail(
  error: string,
  message: string,
  status = 400,
  details?: unknown,
) {
  const body: ApiFailure = { success: false, error, message };
  if (details !== undefined) body.details = details;
  return NextResponse.json(body, { status });
}

/**
 * Converts any thrown value into a consistent failure response.
 * Server-side stack traces are logged, never returned to the client.
 */
export function toErrorResponse(scope: string, error: unknown) {
  if (error instanceof ScriptError) {
    console.error(`[${scope}] ${error.code}: ${error.message}`, error.details ?? "");
    return jsonFail(error.code, error.message, error.httpStatus, error.details);
  }

  console.error(`[${scope}] unexpected error`, error);
  return jsonFail(
    "INTERNAL_ERROR",
    "Something went wrong while talking to the cafe backend. Please try again.",
    500,
  );
}

/**
 * Failure envelope for the demo data layer routes, matching the Apps Script
 * convention `{ success: false, error: "<human message>" }`.
 */
export function apiFail(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * Converts a thrown `ApiError` (the `lib/api.ts` data layer) into the
 * `{ success: false, error: "<message>" }` envelope the demo UI understands.
 */
export function toApiErrorResponse(scope: string, error: unknown) {
  if (error instanceof ApiError) {
    console.error(`[${scope}] ${error.code}: ${error.message}`);
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error(`[${scope}] unexpected error`, error);
  return NextResponse.json(
    { success: false, error: "Unexpected server error while contacting the backend." },
    { status: 500 },
  );
}
