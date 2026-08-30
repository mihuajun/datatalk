import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";

export async function POST() {
  const response = NextResponse.json({
    success: true,
    redirectTo: "/",
  });

  response.cookies.delete(AUTH_COOKIE_NAME);

  return response;
}
