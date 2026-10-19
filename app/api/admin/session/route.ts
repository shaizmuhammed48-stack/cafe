import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import { isAdminConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

/** GET /api/admin/session — lets the admin UI decide whether to show the login form. */
export async function GET() {
  const configured = isAdminConfigured();
  const authenticated = configured ? await isAdminAuthenticated() : false;

  return NextResponse.json({
    success: true,
    configured,
    authenticated,
  });
}
