/**
 * Data layer for the Google Apps Script / Google Sheets backend.
 *
 * SERVER-SIDE ONLY — this module reads `APPS_SCRIPT_URL` from the environment.
 * Never import it from a client component: the URL must stay on the server (the
 * browser talks to /api/* route handlers instead, avoiding CORS).
 *
 * The Apps Script web app answers every request with `{ success, data | error }`.
 */

import type { InventoryItem, OrderRecord } from "./types";

/** One row of the `Items` tab. */
export interface Item {
  id: string;
  category: string;
  name: string;
  image: string;
  stock: number;
}

/**
 * One row of the `Orders` tab, as returned by `?type=orders` (the backend joins
 * in `item name` / `item image`). Column names keep their literal sheet headers.
 */
export interface Order {
  "order id": string;
  "item id": string;
  "quantity order": number;
  "payment status": string;
  "item name": string;
  "item image": string;
}

export type PaymentStatus = "pending" | "paid";

export interface CreateOrderInput {
  itemId: string;
  quantity: number;
  paymentStatus?: PaymentStatus;
}

export interface CreateOrderResult {
  order: Record<string, unknown> | null;
  remainingStock: number | null;
}

export interface UpdatePaymentInput {
  orderId: string;
  paymentStatus: PaymentStatus;
}

/** A backend/config failure, already turned into a safe client message. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = options.code ?? "UPSTREAM_ERROR";
    this.status = options.status ?? 502;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function isAppsScriptConfigured(): boolean {
  return (process.env.APPS_SCRIPT_URL ?? "").trim().length > 0;
}

function scriptUrl(): string {
  const url = (process.env.APPS_SCRIPT_URL ?? "").trim();
  if (!url) {
    throw new ApiError(
      "APPS_SCRIPT_URL is not set. Add your Apps Script web app /exec URL to .env.local.",
      { code: "CONFIG_ERROR", status: 503 },
    );
  }
  return url;
}

type QueryParams = Record<string, string | number | undefined>;

function buildUrl(params: QueryParams): string {
  // `new URL` keeps an existing ?query (Apps Script /exec URLs sometimes carry one).
  const url = new URL(scriptUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Performs one request against the Apps Script web app.
 *
 * - follows the 302 redirect Apps Script issues
 * - `cache: "no-store"` so inventory is never stale
 * - POST bodies go as `JSON.stringify(...)` with `text/plain;charset=utf-8`
 *   (Apps Script reads `postData.contents` and this content type avoids a
 *   CORS preflight)
 * - verifies the `success` field and throws `ApiError` with the `error` message
 */
async function request(params: QueryParams, body?: unknown): Promise<Record<string, unknown>> {
  const url = buildUrl(params);
  const timeoutMs = Number(process.env.APPS_SCRIPT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
      headers: body === undefined ? { Accept: "application/json" } : {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ApiError(
      aborted
        ? `The Apps Script backend did not respond within ${timeoutMs}ms.`
        : "Could not reach the Apps Script backend. Check your network connection.",
      { code: aborted ? "TIMEOUT" : "NETWORK_ERROR", status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiError(
      `The Apps Script backend returned a non-JSON response (HTTP ${response.status}). ` +
        "Make sure the deployment is shared with 'Anyone'.",
      { code: "BAD_RESPONSE", status: 502 },
    );
  }

  if (!response.ok) {
    throw new ApiError(`The Apps Script backend returned HTTP ${response.status}.`, {
      code: "UPSTREAM_HTTP",
      status: 502,
    });
  }

  const record = payload as Record<string, unknown>;
  if (record.success !== true) {
    const message =
      typeof record.error === "string" && record.error.trim()
        ? record.error.trim()
        : "The Apps Script backend reported a failure.";
    throw new ApiError(message, { code: "UPSTREAM_ERROR", status: 400 });
  }

  return record;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Narrows an unknown row to an `Item`, or null when it has no id. */
function toItem(raw: unknown): Item | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = asString(row.id).trim();
  if (!id) return null;
  return {
    id,
    category: asString(row.category),
    name: asString(row.name) || id,
    image: asString(row.image),
    stock: Number(row.stock) || 0,
  };
}

/** Narrows an unknown row to an `Order`, or null when it has no order id. */
function toOrder(raw: unknown): Order | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const orderId = asString(row["order id"]).trim();
  if (!orderId) return null;
  return {
    "order id": orderId,
    "item id": asString(row["item id"]),
    "quantity order": Number(row["quantity order"]) || 0,
    "payment status": asString(row["payment status"]),
    "item name": asString(row["item name"]),
    "item image": asString(row["item image"]),
  };
}

function toArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ApiError(`The backend did not return an array for ${label}.`, {
      code: "BAD_RESPONSE",
      status: 502,
    });
  }
  return value;
}

/* ── Public API ────────────────────────────────────────────────────────────── */

/** GET all items, optionally filtered by category and/or id. */
export async function getItems(filter: { category?: string; id?: string } = {}): Promise<Item[]> {
  const payload = await request({ type: "items", category: filter.category, id: filter.id });
  return toArray(payload.data, "items")
    .map(toItem)
    .filter((item): item is Item => item !== null);
}

/** GET all orders, optionally filtered by status and/or order id. */
export async function getOrders(filter: { status?: string; orderId?: string } = {}): Promise<Order[]> {
  const payload = await request({ type: "orders", status: filter.status, orderId: filter.orderId });
  return toArray(payload.data, "orders")
    .map(toOrder)
    .filter((order): order is Order => order !== null);
}

/** POST createOrder — the backend also deducts stock. */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const payload = await request({}, {
    action: "createOrder",
    itemId: input.itemId,
    quantity: input.quantity,
    paymentStatus: normalizePaymentStatus(input.paymentStatus),
  });
  return {
    order: (payload.order as Record<string, unknown> | undefined) ?? null,
    remainingStock:
      typeof payload.remainingStock === "number" ? payload.remainingStock : null,
  };
}

/** POST update payment status for a single order. */
export async function updatePayment(input: UpdatePaymentInput): Promise<Record<string, unknown>> {
  return request({}, {
    action: "updatePayment",
    orderId: input.orderId,
    paymentStatus: input.paymentStatus,
  });
}

function isPaymentStatus(value: unknown): value is PaymentStatus {
  return value === "pending" || value === "paid";
}

/** Normalises a caller-supplied status, defaulting to "pending". */
export function normalizePaymentStatus(value: unknown): PaymentStatus {
  return isPaymentStatus(value) ? value : "pending";
}

/* ── Adapters onto the existing app's domain types ─────────────────────────── */

/** Item → the `InventoryItem` shape used by the legacy pages. */
export function toInventoryItems(items: Item[]): InventoryItem[] {
  return items.map((item) => ({
    id: item.id,
    category: item.category,
    name: item.name,
    image: item.image,
    stock: item.stock,
    price: null,
  }));
}

/** Order → the `OrderRecord` shape used by the legacy pages. */
export function toOrderRecords(orders: Order[]): OrderRecord[] {
  return orders.map((order) => ({
    orderId: order["order id"],
    itemId: order["item id"],
    quantity: order["quantity order"],
    paymentStatus: order["payment status"],
  }));
}

/** True when a `APPS_SCRIPT_URL` value is present and usable. */
export function isAppsScriptUrlConfigured(): boolean {
  return scriptUrl().length > 0;
}
