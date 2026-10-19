import { fetchInventory } from "@/lib/appsScript";
import { jsonFail, jsonOk, toErrorResponse } from "@/lib/apiResponse";
import { getScriptUrlHint, getScriptUrlProblem } from "@/lib/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/inventory
 * Reads the live `items list` tab through the Apps Script backend.
 * Never falls back to mock data — a failure is reported as a failure.
 */
export async function GET() {
  const problem = getScriptUrlProblem();
  if (problem) {
    return jsonFail("CONFIG_ERROR", getScriptUrlHint(problem), 503);
  }

  try {
    const items = await fetchInventory();
    return jsonOk({ items, meta: { count: items.length } });
  } catch (error) {
    return toErrorResponse("api/inventory", error);
  }
}
