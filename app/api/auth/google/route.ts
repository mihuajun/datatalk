import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getGoogleAuthorizationUrl, isGoogleConfigured } from "@/lib/server/google-auth";
import { isRegistrationEnabled } from "@/lib/server/auth-config";

export async function GET(request: Request) {
  if (!isRegistrationEnabled()) return NextResponse.json({ success: false, message: "第三方登录功能已关闭。" }, { status: 403 });
  if (!isGoogleConfigured()) return NextResponse.json({ success: false, message: "Google 登录尚未配置，请联系管理员。" }, { status: 503 });
  const state = randomBytes(24).toString("base64url");
  const next = new URL(request.url).searchParams.get("next") || "/";
  const response = NextResponse.redirect(getGoogleAuthorizationUrl(request, state));
  const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: 10 * 60 };
  response.cookies.set("datatalk-google-state", state, options);
  response.cookies.set("datatalk-google-next", next, options);
  return response;
}
