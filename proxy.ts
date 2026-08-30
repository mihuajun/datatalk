import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";

const publicPaths = new Set(["/", "/icon.svg"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (publicPaths.has(pathname) || pathname.startsWith("/link/") || pathname.startsWith("/vendor/")) {
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
