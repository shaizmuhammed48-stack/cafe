import { NextResponse } from "next/server";
import { enrichOrders, fetchAll, postCreateOrder } from "@/lib/appsScript";
import { createOrder, getOrders, updatePayment } from "@/lib/api";
import { apiFail, jsonFail, jsonOk, toApiErrorResponse, toErrorResponse } from "@/lib/apiResponse";
import { getScriptUrlHint, getScriptUrlProblem } from "@/lib/config";
import type { EnrichedOrder } from "@/lib/types";
import {
  isPaymentStatus,
  isSameOrigin,
  isValidItemId,
  isValidOrderId,
  parseOrderLines,
  readJsonBody,
} from "@/lib/validate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/orders
 *
 *   /api/orders                  → enriched `orders` **and** raw `data` rows
 *   /api/orders?status=pending   → raw `data` rows, filtered by the backend
 *   /api/orders?orderId=OR004    → a single order's row(s)
 *
 * The unfiltered call reuses the legacy `?action=getAll` client (one request)
 * and additionally maps the result onto the raw row shape the `/demo` page
 * reads, so the old admin/order pages and the demo share one upstream call.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = (searchParams.get("status") ?? "").trim();
  const orderId = (searchParams.get("orderId") ?? "").trim();

  // Filtered queries are only available through the `?type=orders` data layer.
  if (status || orderId) {
    try {
      const data = await getOrders({ status: status || undefined, orderId: orderId || undefined });
      return NextResponse.json({ success: true, data, meta: { count: data.length } });
    } catch (error) {
      return toApiErrorResponse("api/orders#GET", error);
    }
  }

  const problem = getScriptUrlProblem();
  if (problem) {
    return jsonFail("CONFIG_ERROR", getScriptUrlHint(problem), 503);
  }

  try {
    // One round trip: `fetchAll` returns items + orders together, which is all
    // that is needed for both the enriched `orders` array the admin/order pages
    // read and the raw `data` rows the /demo page reads.
    const { items, orders } = await fetchAll();
    const enriched = enrichOrders(orders, items);
    return NextResponse.json({
      success: true,
      data: enriched.map(toRawOrder),
      orders: enriched,
      meta: { count: enriched.length },
    });
  } catch (error) {
    return toErrorResponse("api/orders#GET", error);
  }
}

/**
 * Maps an enriched order back onto the raw Apps Script row shape
 * (`{ "order id", "item id", … }`) that the `/demo` page consumes.
 */
function toRawOrder(order: EnrichedOrder) {
  return {
    "order id": order.orderId,
    "item id": order.itemId,
    "quantity order": order.quantity,
    "payment status": order.paymentStatus,
    "item name": order.itemName,
    "item image": order.itemImage,
  };
}

/**
 * POST /api/orders
 *
 *   { itemId, quantity, paymentStatus? }   → single-item order (new data layer)
 *   { items: [{ itemId, quantity }, ...] } → multi-line order (existing pages)
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return jsonFail("FORBIDDEN", "Cross-site order submissions are not allowed.", 403);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return jsonFail("VALIDATION_ERROR", body.message, 400);
  }

  const value = body.value as Record<string, unknown> | null;

  // ── New single-item contract ──────────────────────────────────────────────
  if (value && typeof value === "object" && "itemId" in value) {
    const quantity = value.quantity;
    const paymentStatus = value.paymentStatus ?? "pending";

    if (!isValidItemId(value.itemId)) {
      return apiFail("A valid itemId is required.", 400);
    }
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
      return apiFail("quantity must be a whole number of at least 1.", 400);
    }
    if (!isPaymentStatus(paymentStatus)) {
      return apiFail('paymentStatus must be "pending" or "paid".', 400);
    }

    try {
      const result = await createOrder({
        itemId: value.itemId.trim(),
        quantity,
        paymentStatus,
      });
      return jsonOk({ order: result.order, remainingStock: result.remainingStock }, 201);
    } catch (error) {
      return toApiErrorResponse("api/orders#POST", error);
    }
  }

  // ── Existing multi-line contract ──────────────────────────────────────────
  const lines = parseOrderLines(body.value);
  if (!lines.ok) {
    return jsonFail("VALIDATION_ERROR", lines.message, 400, lines.details);
  }

  try {
    const result = await postCreateOrder(lines.value);
    return jsonOk(
      {
        orderId: result.orderId,
        orderIds: result.orderIds,
        message: result.message,
        items: result.items,
        stock: result.stock,
      },
      201,
    );
  } catch (error) {
    return toErrorResponse("api/orders#POST", error);
  }
}

/**
 * PATCH /api/orders
 * Updates one order's payment status: { orderId, paymentStatus }.
 */
export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return jsonFail("FORBIDDEN", "Cross-site updates are not allowed.", 403);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return jsonFail("VALIDATION_ERROR", body.message, 400);
  }

  const value = body.value as Record<string, unknown> | null;
  const orderId = value?.orderId;
  const paymentStatus = value?.paymentStatus;

  if (!isValidOrderId(orderId)) {
    return apiFail("A valid orderId is required.", 400);
  }
  if (!isPaymentStatus(paymentStatus)) {
    return apiFail('paymentStatus must be "pending" or "paid".', 400);
  }

  try {
    const result = await updatePayment({ orderId, paymentStatus });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return toApiErrorResponse("api/orders#PATCH", error);
  }
}
