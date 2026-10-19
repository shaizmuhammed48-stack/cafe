/**
 * Shared domain types for the Cafe Order Management System.
 *
 * The Google Sheet is the single source of truth for inventory + orders.
 * Nothing in this file holds stock or order data — only shapes.
 */

export type PaymentStatus = "pending" | "paid";

/** A row from the `items list` tab (A: id, B: category, C: name, D: image, E: stock). */
export interface InventoryItem {
  id: string;
  category: string;
  name: string;
  image: string;
  stock: number;
  /**
   * Optional. The sheet has no price column today, so the API layer merges a
   * configurable price map (lib/pricing.ts). If sheet column F is filled in,
   * that value wins. `null` means "price not configured".
   */
  price: number | null;
}

/** A row from the `order list` tab (A: order id, B: item id, C: quantity, D: payment status). */
export interface OrderRecord {
  orderId: string;
  itemId: string;
  quantity: number;
  paymentStatus: string;
}

/** An order row enriched with inventory data for display. */
export interface EnrichedOrder extends OrderRecord {
  /**
   * Stable, unique key for list rendering. `orderId-itemId` is **not** unique:
   * a sheet can legitimately hold the same item twice under one order id, and a
   * duplicate row is a data problem we should not hide. The row's position is
   * therefore part of the id. Use this as the React `key`.
   */
  rowId: string;
  itemName: string;
  itemCategory: string;
  itemImage: string;
  /** Resolved unit price (0 when the item has no configured price). */
  unitPrice: number;
  lineTotal: number;
  /** True when the item id no longer exists in the `items list` tab. */
  unknownItem: boolean;
}

/** One line in a checkout request. */
export interface OrderLineInput {
  itemId: string;
  quantity: number;
}

/** Stock snapshot returned by the Apps Script backend after a successful order. */
export type StockSnapshot = Record<string, number>;

export interface CreateOrderSuccess {
  success: true;
  orderId: string;
  message: string;
  items: OrderLineInput[];
  /** Updated stock per item id, e.g. { a1: 77 }. */
  stock: StockSnapshot;
}

export interface ApiFailure {
  success: false;
  /** Machine readable code, e.g. OUT_OF_STOCK | VALIDATION_ERROR | CONFIG_ERROR. */
  error: string;
  message: string;
  /** Optional per-line detail, e.g. which products failed validation. */
  details?: unknown;
}

export type ApiResult<T> = ({ success: true } & T) | ApiFailure;

/** Raw envelope returned by the Apps Script web app. */
export interface ScriptEnvelope {
  success?: boolean;
  /** Alternate success flag used by some Apps Script deployments. */
  ok?: boolean;
  message?: string;
  error?: string;
  details?: unknown;
  items?: unknown;
  orders?: unknown;
  orderId?: string;
  /** Single order row returned by the `itemId`-style createOrder contract. */
  order?: unknown;
  stock?: unknown;
  /** Remaining stock for the ordered item (single-item createOrder contract). */
  remainingStock?: unknown;
  updated?: number;
  /** Rows touched by `updatePayment` (the deployed script's field name). */
  rowsUpdated?: number;
}

export interface CartLine {
  itemId: string;
  quantity: number;
}
