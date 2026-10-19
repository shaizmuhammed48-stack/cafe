import { NextResponse } from "next/server";
import { destroyAdminSession } from "@/lib/adminAuth";
import { isSameOrigin } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** POST /api/admin/logout — clears the admin session cookie. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { success: false, error: "FORBIDDEN", message: "Cross-site requests are not allowed." },
      { status: 403 },
    );
  }

  await destroyAdminSession();
  return NextResponse.json({ success: true });
}
