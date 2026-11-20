import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";

// Exact, credential-free MCP runtime artifact; do not expose other workspace files.
const publicPaths = new Set(["/studio-runtime/studio-report-local.cjs","/", "/register", "/reset-password", "/terms", "/privacy", "/icon.svg", "/brands/workbuddy.svg",
  // Public brand assets only; application routes remain authenticated.
  "/apple-icon.png", "/manifest.webmanifest",
  "/brand/datatalk-cobalt-v1.svg", "/brand/datatalk-white-v1.svg",
  "/brand/icon-192-cobalt-v1.png", "/brand/icon-512-cobalt-v1.png",
  "/brand/maskable-192-cobalt-v1.png", "/brand/maskable-512-cobalt-v1.png",
]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (publicPaths.has(pathname) || pathname.startsWith("/.well-known/") || pathname.startsWith("/oauth/") || pathname.startsWith("/preview/") || pathname.startsWith("/auth/") || pathname.startsWith("/link/") || pathname.startsWith("/share/") || pathname.startsWith("/vendor/")) {
    return NextResponse.next();
  }

  if (request.cookies.get(AUTH_COOKIE_NAME)?.value) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
