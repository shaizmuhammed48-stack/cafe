import type {
  ApiFailure,
  EnrichedOrder,
  InventoryItem,
  OrderLineInput,
  OrderRecord,
  ScriptEnvelope,
  StockSnapshot,
} from "./types";
import { getScriptUrl, getScriptUrlHint, getScriptUrlProblem, getTimeoutMs } from "./config";
import { resolvePrice } from "./pricing";

/**
 * Thin, defensive client for the Google Apps Script web app.
 *
 * Everything here runs on the server (route handlers), so the deployment URL
 * and any future credentials never reach the browser.
 */

export type ScriptErrorCode =
  | "CONFIG_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "BAD_RESPONSE"
  | "UPSTREAM_ERROR"
  | "OUT_OF_STOCK"
  | "VALIDATION_ERROR"
  | "UNKNOWN_ITEM"
  | "ORDER_NOT_FOUND";

export class ScriptError extends Error {
  readonly code: ScriptErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  readonly upstreamStatus?: number;

  constructor(
    code: ScriptErrorCode,
    message: string,
    options: { httpStatus?: number; details?: unknown; upstreamStatus?: number } = {},
  ) {
    super(message);
    this.name = "ScriptError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? 502;
    this.details = options.details;
    this.upstreamStatus = options.upstreamStatus;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Allows a localhost stub to stand in for Apps Script during tests. */
function isLocalEndpoint(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url);
}

function asNumber(value: unknown, fallback = NaN): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseItems(raw: unknown): InventoryItem[] {
  if (!Array.isArray(raw)) return [];
  const items: InventoryItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = asString(record.id).trim();
    if (!id) continue;

    const stockRaw = asNumber(record.stock, 0);
    const priceRaw = record.price === null || record.price === undefined ? NaN : asNumber(record.price);

    items.push({
      id,
      category: asString(record.category).trim().toLowerCase() || "uncategorised",
      name: asString(record.name).trim() || id,
      image: asString(record.image).trim(),
      stock: Number.isFinite(stockRaw) ? Math.max(0, Math.trunc(stockRaw)) : 0,
      price: Number.isFinite(priceRaw) && priceRaw > 0 ? priceRaw : null,
    });
  }
  return items;
}

/** First non-empty string among the given keys (camelCase or sheet header). */
function pickString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = asString(record[key]).trim();
    if (value) return value;
  }
  return "";
}

/** First finite number among the given keys, else 0. */
function pickNumber(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = asNumber(record[key], NaN);
    if (Number.isFinite(value)) return Math.trunc(value);
  }
  return 0;
}

function parseOrders(raw: unknown): OrderRecord[] {
  if (!Array.isArray(raw)) return [];
  const orders: OrderRecord[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    // Code.gs answers with camelCase keys, the deployed sheet script echoes the
    // sheet headers ("order id", "quantity order", …) — accept both.
    const orderId = pickString(record, "orderId", "order id", "order_id", "id");
    const itemId = pickString(record, "itemId", "item id", "item_id");
    if (!orderId && !itemId) continue;
    orders.push({
      orderId,
      itemId,
      quantity: pickNumber(record, "quantity", "quantity order", "quantityOrder"),
      paymentStatus:
        pickString(record, "paymentStatus", "payment status", "payment_status").toLowerCase() ||
        "pending",
    });
  }
  return orders;
}

function parseStock(raw: unknown): StockSnapshot {
  const snapshot: StockSnapshot = {};
  if (typeof raw !== "object" || raw === null) return snapshot;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = asNumber(value, NaN);
    if (Number.isFinite(parsed)) snapshot[key] = Math.trunc(parsed);
  }
  return snapshot;
}

/** Maps an upstream error string onto a typed code + sensible HTTP status. */
function mapUpstreamError(code: string): { code: ScriptErrorCode; httpStatus: number } {
  const normalised = code.trim().toUpperCase();
  switch (normalised) {
    case "OUT_OF_STOCK":
    case "INSUFFICIENT_STOCK":
      return { code: "OUT_OF_STOCK", httpStatus: 409 };
    case "VALIDATION_ERROR":
    case "INVALID_QUANTITY":
    case "INVALID_REQUEST":
      return { code: "VALIDATION_ERROR", httpStatus: 400 };
    case "UNKNOWN_ITEM":
    case "ITEM_NOT_FOUND":
      return { code: "UNKNOWN_ITEM", httpStatus: 404 };
    case "ORDER_NOT_FOUND":
      return { code: "ORDER_NOT_FOUND", httpStatus: 404 };
    default:
      return { code: "UPSTREAM_ERROR", httpStatus: 502 };
  }
}

/**
 * Turns a non-2xx status from the deployed web app into a diagnosis that names
 * the actual cause. A 404 and a 403 have completely different fixes, so a
 * one-size-fits-all "check access is Anyone" message would be misleading.
 */
function describeUpstreamStatus(status: number): string {
  switch (status) {
    case 400:
      return "Google Apps Script responded with HTTP 400. The script rejected the request " +
        "shape — check that the request body matches the documented contract in " +
        "google-apps-script/Code.gs.";
    case 403:
      return "Google Apps Script responded with HTTP 403. The deployment is not publicly " +
        "reachable — redeploy it with \"Who has access: Anyone\" while signed in as the account " +
        "that owns the script.";
    case 404:
      return "Google Apps Script responded with HTTP 404. The deployment URL does not exist: " +
        "the deployment id is wrong, it belongs to a deleted version, or the value in " +
        ".env.local is still a placeholder. In the Apps Script editor open Deploy → Manage " +
        "deployments, pick \"New version\" (Web app, Execute as: Me, Access: Anyone) and paste " +
        "the fresh URL that ends in /exec into GOOGLE_APPS_SCRIPT_URL.";
    case 405:
      return "Google Apps Script responded with HTTP 405. That URL is not an executable web " +
        "app — redeploy it as a Web app and use the /exec URL.";
    case 429:
      return "Google Apps Script responded with HTTP 429. Google's execution rate limit or " +
        "daily quota was exceeded — wait a few minutes and retry.";
    default:
      if (status >= 500) {
        return `Google Apps Script failed with HTTP ${status}. The script threw while handling ` +
          "the request — open the Apps Script editor → Executions to read the stack trace. The " +
          "usual causes are CONFIG.SPREADSHEET_ID not being set, or a sheet tab not named " +
          "exactly \"items list\" / \"order list\".";
      }
      return `Google Apps Script responded with HTTP ${status}.`;
  }
}

/**
 * Summarises a raw envelope so a shape mismatch (for example a deployment that
 * uses `ok`/`error` instead of `success`/`message`) is visible in the error
 * instead of being swallowed. Never invents data — it only reports what arrived.
 */
function describeEnvelope(envelope: unknown): string {
  let summary: string;
  try {
    summary = JSON.stringify(envelope);
  } catch {
    summary = String(envelope);
  }
  if (summary.length > 240) summary = `${summary.slice(0, 240)}…`;
  return summary;
}

/**
 * True when the payload is a JSON object that is not the envelope documented in
 * google-apps-script/Code.gs — e.g. it carries `ok` instead of `success`. That
 * almost always means the deployed script is a different project or an older
 * version.
 */
function looksLikeForeignEnvelope(envelope: ScriptEnvelope): boolean {
  const record = envelope as Record<string, unknown>;
  return envelope.success === undefined && typeof record.ok === "boolean";
}

const WRONG_SCRIPT_HINT =
  " The deployed web app does not match the contract in google-apps-script/Code.gs " +
  "(it replies with \"ok\" instead of \"success\"), so it is a different Apps Script project " +
  "or an outdated version. Paste google-apps-script/Code.gs into the script bound to your " +
  "sheet, then Deploy → Manage deployments → New version.";

interface ScriptRequest {
  method: "GET" | "POST";
  /** Query params appended to the /exec URL (GET only). */
  params?: Record<string, string>;
  /** JSON payload for POST requests. */
  body?: unknown;
  timeoutMs?: number;
}

async function requestScript(request: ScriptRequest): Promise<ScriptEnvelope> {
  const baseUrl = getScriptUrl();
  if (!baseUrl) {
    const problem = getScriptUrlProblem() ?? "missing";
    throw new ScriptError("CONFIG_ERROR", getScriptUrlHint(problem), { httpStatus: 503 });
  }

  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/.test(baseUrl) && !isLocalEndpoint(baseUrl)) {
    throw new ScriptError(
      "CONFIG_ERROR",
      "GOOGLE_APPS_SCRIPT_URL is malformed — expected https://script.google.com/macros/s/" +
        "<DEPLOYMENT_ID>/exec (no trailing path, no extra whitespace). Got: " +
        JSON.stringify(baseUrl),
      { httpStatus: 503 },
    );
  }

  const url = new URL(baseUrl);
  if (request.params) {
    for (const [key, value] of Object.entries(request.params)) {
      url.searchParams.set(key, value);
    }
  }

  const controller = new AbortController();
  const timeoutMs = request.timeoutMs ?? getTimeoutMs();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers:
        request.method === "POST"
          ? { "Content-Type": "application/json", Accept: "application/json" }
          : { Accept: "application/json" },
      body: request.method === "POST" ? JSON.stringify(request.body ?? {}) : undefined,
      // Apps Script answers POSTs with a 302 to a googleusercontent echo URL.
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ScriptError(
        "TIMEOUT",
        `The Google Apps Script backend did not respond within ${timeoutMs}ms. Please retry.`,
        { httpStatus: 504 },
      );
    }
    throw new ScriptError(
      "NETWORK_ERROR",
      `Could not reach the Google Apps Script backend: ${
        error instanceof Error ? error.message : String(error)
      }. Check that GOOGLE_APPS_SCRIPT_URL is correct and that this machine can reach ` +
        "script.google.com (internet / proxy / firewall).",
      { httpStatus: 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => "");

  if (!response.ok) {
    // Checked before the body so an HTML error page (a Google 404/403 page) is
    // diagnosed by status rather than mis-read as malformed JSON.
    throw new ScriptError(
      "UPSTREAM_ERROR",
      describeUpstreamStatus(response.status),
      { httpStatus: 502, upstreamStatus: response.status, details: { upstreamStatus: response.status } },
    );
  }

  const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text);
  if (looksLikeHtml) {
    throw new ScriptError(
      "BAD_RESPONSE",
      "Google Apps Script returned an HTML page instead of JSON (HTTP " +
        `${response.status}). The /exec URL is either not a deployed Web app, or it is ` +
        "redirecting to a Google sign-in page. Redeploy with Execute as: Me, Who has access: " +
        "Anyone, then paste the fresh URL that ends in /exec.",
      { httpStatus: 502, details: { upstreamStatus: response.status } },
    );
  }

  let envelope: ScriptEnvelope;
  try {
    envelope = JSON.parse(text) as ScriptEnvelope;
  } catch {
    throw new ScriptError(
      "BAD_RESPONSE",
      text.trim().length === 0
        ? "Google Apps Script returned an empty response body. The deployment usually needs a " +
          "fresh version (Deploy → Manage deployments → New version), or the request was " +
          "redirected and the body was dropped."
        : `Google Apps Script returned a non-JSON response: ${text.slice(0, 180)}`,
      { httpStatus: 502, details: { snippet: text.slice(0, 180) } },
    );
  }

  const record = envelope as Record<string, unknown>;

  // Tolerate the alternate `{ ok: true }` success envelope that some Apps
  // Script deployments use, so a compatible backend is not rejected on shape
  // alone. `{ ok: false }` is still treated as a failure below.
  if (envelope.success === undefined && record.ok === true) {
    envelope.success = true;
  }

  const explicitFailure = envelope.success === false || record.ok === false;

  if (explicitFailure) {
    const upstreamCode = asString(envelope.error) || asString(record.error);
    const upstreamMessage =
      asString(envelope.message) ||
      asString(record.message) ||
      asString(record.error) ||
      "The backend rejected the request.";
    const mapped = mapUpstreamError(upstreamCode);
    const foreign = looksLikeForeignEnvelope(envelope);
    throw new ScriptError(mapped.code, foreign ? upstreamMessage + WRONG_SCRIPT_HINT : upstreamMessage, {
      httpStatus: mapped.httpStatus,
      details: envelope.details ?? (foreign ? envelope : undefined),
    });
  }

  return envelope;
}

/** GET ?action=getInventory */
export async function fetchInventory(): Promise<InventoryItem[]> {
  const envelope = await requestScript({
    method: "GET",
    params: { action: "getInventory" },
  });
  if (!Array.isArray(envelope.items)) {
    throw new ScriptError(
      "BAD_RESPONSE",
      "The backend did not return an items array for action=getInventory. Received: " +
        describeEnvelope(envelope) +
        " The deployed web app must answer with {\"success\":true,\"items\":[…]}; " +
        "google-apps-script/Code.gs implements exactly that contract." +
        (looksLikeForeignEnvelope(envelope) ? WRONG_SCRIPT_HINT : ""),
      { httpStatus: 502, details: envelope },
    );
  }
  return parseItems(envelope.items);
}

/** GET ?action=getOrders */
export async function fetchOrders(): Promise<OrderRecord[]> {
  const envelope = await requestScript({
    method: "GET",
    params: { action: "getOrders" },
  });
  if (!Array.isArray(envelope.orders)) {
    throw new ScriptError(
      "BAD_RESPONSE",
      "The backend did not return an orders array for action=getOrders. Received: " +
        describeEnvelope(envelope) +
        (looksLikeForeignEnvelope(envelope) ? WRONG_SCRIPT_HINT : ""),
      { httpStatus: 502, details: envelope },
    );
  }
  return parseOrders(envelope.orders);
}

/** GET ?action=getAll — one round trip for inventory + orders. */
export async function fetchAll(): Promise<{ items: InventoryItem[]; orders: OrderRecord[] }> {
  const envelope = await requestScript({
    method: "GET",
    params: { action: "getAll" },
  });
  if (!Array.isArray(envelope.items) || !Array.isArray(envelope.orders)) {
    throw new ScriptError(
      "BAD_RESPONSE",
      "The backend did not return both items and orders for action=getAll. Received: " +
        describeEnvelope(envelope) +
        (looksLikeForeignEnvelope(envelope) ? WRONG_SCRIPT_HINT : ""),
      { httpStatus: 502, details: envelope },
    );
  }
  return { items: parseItems(envelope.items), orders: parseOrders(envelope.orders) };
}

export interface CreateOrderResult {
  orderId: string;
  /** Every order id created. >1 when a multi-line cart is split per line. */
  orderIds: string[];
  message: string;
  items: OrderLineInput[];
  stock: StockSnapshot;
}

/**
 * Which createOrder shape this deployment understands, learned from the first
 * request and cached for the life of the process:
 *   null     — not attempted yet
 *   "batch"  — accepts the whole cart (`{ items: [...] }`)
 *   "single" — only accepts one line (`{ itemId, quantity }`)
 */
let createOrderMode: "batch" | "single" | null = null;

/** True when the backend rejected `{ items: [...] }` because it needs `itemId`. */
function isSingleItemOnly(error: unknown): boolean {
  return (
    error instanceof ScriptError &&
    /itemId/i.test(error.message) &&
    /required/i.test(error.message)
  );
}

/** POST { action: "createOrder", itemId, quantity, paymentStatus } — one line. */
async function postSingleOrder(
  line: OrderLineInput,
): Promise<{ orderId: string; stock: StockSnapshot }> {
  const envelope = await requestScript({
    method: "POST",
    body: {
      action: "createOrder",
      itemId: line.itemId,
      quantity: line.quantity,
      paymentStatus: "pending",
    },
  });

  const order =
    envelope.order && typeof envelope.order === "object"
      ? (envelope.order as Record<string, unknown>)
      : {};

  const orderId =
    asString(order["order id"]).trim() ||
    asString(order.orderId).trim() ||
    asString(envelope.orderId).trim();

  if (!orderId) {
    throw new ScriptError(
      "BAD_RESPONSE",
      "The backend confirmed the order but did not return an order id, so it cannot be shown as placed.",
      { httpStatus: 502, details: envelope },
    );
  }

  const stock: StockSnapshot = {};
  const remaining = asNumber(envelope.remainingStock, NaN);
  if (Number.isFinite(remaining)) {
    stock[line.itemId] = remaining;
  } else {
    // Code.gs answers with a whole-cart stock map instead of `remainingStock`.
    const map = parseStock(envelope.stock);
    if (typeof map[line.itemId] === "number") stock[line.itemId] = map[line.itemId];
  }

  return { orderId, stock };
}

/** One request per line — for backends without a batch createOrder. */
async function postOrderLines(lines: OrderLineInput[]): Promise<CreateOrderResult> {
  const orderIds: string[] = [];
  const stock: StockSnapshot = {};

  for (const line of lines) {
    const result = await postSingleOrder(line);
    orderIds.push(result.orderId);
    Object.assign(stock, result.stock);
  }

  return {
    orderId: orderIds.join(", "),
    orderIds,
    items: lines,
    stock,
    message:
      orderIds.length === 1
        ? `Order ${orderIds[0]} confirmed.`
        : `${orderIds.length} orders confirmed: ${orderIds.join(", ")}.`,
  };
}

/** POST { action: "createOrder", items: [...] } — the whole cart in one call. */
async function postOrderBatch(items: OrderLineInput[]): Promise<CreateOrderResult> {
  const envelope = await requestScript({
    method: "POST",
    body: { action: "createOrder", items },
  });

  const orderId = asString(envelope.orderId).trim();
  if (!orderId) {
    throw new ScriptError(
      "BAD_RESPONSE",
      "The backend did not confirm an order id, so the order cannot be considered placed.",
      { httpStatus: 502 },
    );
  }

  return {
    orderId,
    orderIds: [orderId],
    message: asString(envelope.message) || `Order ${orderId} confirmed.`,
    items,
    stock: parseStock(envelope.stock),
  };
}

/**
 * Creates an order.
 *
 * Two contracts exist:
 *   - google-apps-script/Code.gs takes the whole cart at once
 *     (`{ items: [...] }`) and writes a single order id for every line.
 *   - The deployed web app only accepts one line per call
 *     (`{ itemId, quantity }`), so a multi-line cart is sent as one request per
 *     line and comes back with one order id per line.
 *
 * A multi-line cart tries the batch form first; the first outright rejection
 * switches the process to one request per line, so the probe costs one request
 * at most.
 */
export async function postCreateOrder(items: OrderLineInput[]): Promise<CreateOrderResult> {
  // A single line (and a backend already known to be single-item only) goes
  // straight to the item form — a batch probe would be wasted work.
  if (items.length < 2 || createOrderMode === "single") {
    return postOrderLines(items);
  }

  try {
    const result = await postOrderBatch(items);
    createOrderMode = "batch";
    return result;
  } catch (error) {
    // The deployed sheet script refuses the batch shape outright, so fall back
    // to one request per line. Any other failure (out of stock, transport, …)
    // is a real error and must not be retried line by line.
    if (!isSingleItemOnly(error)) throw error;
    createOrderMode = "single";
    return postOrderLines(items);
  }
}

/** POST { action: "updatePayment", orderId, paymentStatus } */
export async function postPaymentStatus(
  orderId: string,
  paymentStatus: string,
): Promise<{ updated: number; message: string }> {
  const envelope = await requestScript({
    method: "POST",
    body: { action: "updatePayment", orderId, paymentStatus },
  });

  return {
    updated: asNumber(envelope.rowsUpdated, asNumber(envelope.updated, 0)),
    message: asString(envelope.message) || `Order ${orderId} marked ${paymentStatus}.`,
  };
}

/** Resolves inventory items into enriched order rows for the admin console. */
export function enrichOrders(orders: OrderRecord[], items: InventoryItem[]): EnrichedOrder[] {
  const byId = new Map(items.map((item) => [item.id, item]));

  return orders.map((order, index) => {
    const item = byId.get(order.itemId);
    const unitPrice = item ? resolvePrice(item) : 0;
    return {
      ...order,
      rowId: `${order.orderId}-${order.itemId}-${index}`,
      itemName: item?.name ?? order.itemId,
      itemCategory: item?.category ?? "unknown",
      itemImage: item?.image ?? "",
      unitPrice,
      lineTotal: Math.round(unitPrice * order.quantity * 100) / 100,
      unknownItem: !item,
    };
  });
}
