import { postPaymentStatus } from "@/lib/appsScript";
import { jsonFail, jsonOk, toErrorResponse } from "@/lib/apiResponse";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { isPaymentStatus, isSameOrigin, isValidOrderId, readJsonBody } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/orders/status  (admin only)
 * Updates the `payment status` cell for every row of a given order id.
 * Protected twice: the Edge middleware and this route-level check.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return jsonFail("FORBIDDEN", "Cross-site requests are not allowed.", 403);
  }

  if (!(await isAdminAuthenticated())) {
    return jsonFail("UNAUTHORIZED", "Admin authentication is required for this action.", 401);
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return jsonFail("VALIDATION_ERROR", body.message, 400);
  }

  const payload = body.value as { orderId?: unknown; paymentStatus?: unknown };

  if (!isValidOrderId(payload.orderId)) {
    return jsonFail("VALIDATION_ERROR", "A valid order id is required.", 400);
  }
  if (!isPaymentStatus(payload.paymentStatus)) {
    return jsonFail("VALIDATION_ERROR", 'paymentStatus must be either "pending" or "paid".', 400);
  }

  try {
    const result = await postPaymentStatus(payload.orderId, payload.paymentStatus);
    if (result.updated === 0) {
      return jsonFail("ORDER_NOT_FOUND", `No rows found for order ${payload.orderId}.`, 404);
    }
    return jsonOk({
      orderId: payload.orderId,
      paymentStatus: payload.paymentStatus,
      updated: result.updated,
      message: result.message,
    });
  } catch (error) {
    return toErrorResponse("api/orders/status", error);
  }
}
