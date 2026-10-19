/**
 * Request validation + sanitisation helpers shared by the Next.js API routes.
 *
 * The Apps Script backend re-validates everything (it is the source of truth),
 * but we never forward obviously invalid payloads to it.
 */

import type { OrderLineInput, PaymentStatus } from "./types";

const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_LINES = 50;
const MAX_QUANTITY = 10_000;

export const PAYMENT_STATUSES: readonly PaymentStatus[] = ["pending", "paid"];

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  message: string;
  details?: unknown;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/** Removes control characters and trims surrounding whitespace. */
export function sanitizeText(value: unknown, maxLength = 200): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function isValidItemId(value: unknown): value is string {
  return typeof value === "string" && ITEM_ID_PATTERN.test(value.trim());
}

export function isValidOrderId(value: unknown): value is string {
  return typeof value === "string" && ORDER_ID_PATTERN.test(value.trim());
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Parses and validates an unknown JSON body into a list of order lines.
 * Rejects: non-arrays, empty carts, zero/negative/fractional quantities,
 * duplicate item ids, oversized carts and malformed ids.
 */
export function parseOrderLines(body: unknown): ValidationResult<OrderLineInput[]> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Request body must be a JSON object." };
  }

  const rawItems = (body as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) {
    return { ok: false, message: 'Request body must contain an "items" array.' };
  }
  if (rawItems.length === 0) {
    return { ok: false, message: "Your cart is empty — add at least one item." };
  }
  if (rawItems.length > MAX_LINES) {
    return { ok: false, message: `A single order cannot contain more than ${MAX_LINES} lines.` };
  }

  const seen = new Set<string>();
  const lines: OrderLineInput[] = [];

  for (let index = 0; index < rawItems.length; index += 1) {
    const entry = rawItems[index];
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, message: `Line ${index + 1} is not a valid object.` };
    }

    const itemIdRaw = (entry as { itemId?: unknown }).itemId;
    const quantityRaw = (entry as { quantity?: unknown }).quantity;

    if (!isValidItemId(itemIdRaw)) {
      return { ok: false, message: `Line ${index + 1} has an invalid item id.` };
    }

    const itemId = (itemIdRaw as string).trim();

    if (typeof quantityRaw !== "number" || !Number.isInteger(quantityRaw)) {
      return {
        ok: false,
        message: `Line ${index + 1} (${itemId}) must have a whole-number quantity.`,
      };
    }
    if (quantityRaw <= 0) {
      return {
        ok: false,
        message: `Line ${index + 1} (${itemId}) must have a quantity of at least 1.`,
      };
    }
    if (quantityRaw > MAX_QUANTITY) {
      return {
        ok: false,
        message: `Line ${index + 1} (${itemId}) exceeds the maximum quantity of ${MAX_QUANTITY}.`,
      };
    }
    if (seen.has(itemId)) {
      return {
        ok: false,
        message: `Item ${itemId} appears more than once — merge the lines before checking out.`,
      };
    }

    seen.add(itemId);
    lines.push({ itemId, quantity: quantityRaw });
  }

  return { ok: true, value: lines };
}

/**
 * Attempts to read a JSON body from a Request. Returns a validation failure
 * instead of throwing so route handlers can respond with a clean 400.
 */
export async function readJsonBody(
  request: Request,
): Promise<ValidationResult<unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, message: "Content-Type must be application/json." };
  }
  try {
    const parsed = (await request.json()) as unknown;
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, message: "Request body is not valid JSON." };
  }
}

/** Rejects state-changing requests that did not originate from this site. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl, tests) send no Origin
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = forwardedHost ?? request.headers.get("host") ?? requestUrl.host;
    return originUrl.host === host || originUrl.host === requestUrl.host;
  } catch {
    return false;
  }
}
