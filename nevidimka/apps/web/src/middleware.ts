import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/csrf";

/**
 * Central CSRF gate for every API route. GET/HEAD requests are expected to
 * be side-effect free (verified route by route — see the security audit
 * that motivated this file) so only state-changing methods are checked.
 * See lib/csrf.ts for why Sec-Fetch-Site is the right signal here.
 */
export function middleware(request: NextRequest): NextResponse | undefined {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return NextResponse.next();
  }

  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { code: "CSRF_REJECTED", message: "Cross-site request rejected." },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
