import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/sessionToken";

/**
 * Protects the admin order console and the payment-status mutation endpoint.
 * Runs on the Edge runtime and verifies the signed session cookie with Web
 * Crypto, so no admin secret ever reaches the client.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The login screen itself is always reachable.
  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  const secret = (process.env.ADMIN_SESSION_SECRET ?? "").trim()
    || ((process.env.ADMIN_PASSWORD ?? "").trim()
      ? `madco-cafe::${(process.env.ADMIN_PASSWORD ?? "").trim()}`
      : "");

  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const session = secret ? await verifySessionToken(secret, token) : null;

  if (session) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        success: false,
        error: "UNAUTHORIZED",
        message: "Admin authentication is required for this action.",
      },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/orders/status"],
};
