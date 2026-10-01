import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { authCookieOptions } from "@/lib/server/auth-session";

export async function POST() {
  const response = NextResponse.json({
    success: true,
    redirectTo: "/",
  });

  response.cookies.set(AUTH_COOKIE_NAME, "", { ...authCookieOptions(), maxAge: 0 });

  return response;
}
