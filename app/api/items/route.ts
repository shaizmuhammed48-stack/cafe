import { NextResponse } from "next/server";
import { getItems } from "@/lib/api";
import { toApiErrorResponse } from "@/lib/apiResponse";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/items
 * Proxies the Apps Script backend server-side (no browser → Apps Script calls).
 *
 *   /api/items                  → every item
 *   /api/items?category=snacks  → items in one category
 *   /api/items?id=a1            → a single item
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = (searchParams.get("category") ?? "").trim() || undefined;
  const id = (searchParams.get("id") ?? "").trim() || undefined;

  try {
    const items = await getItems({ category, id });
    return NextResponse.json({ success: true, data: items, meta: { count: items.length } });
  } catch (error) {
    return toApiErrorResponse("api/items#GET", error);
  }
}
