import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getGitHubAuthorizationUrl, isGitHubConfigured } from "@/lib/server/github-auth";
import { isRegistrationEnabled } from "@/lib/server/auth-config";

export async function GET(request: Request) {
  if (!isRegistrationEnabled()) return NextResponse.json({ success: false, message: "第三方登录功能已关闭。" }, { status: 403 });
  if (!isGitHubConfigured()) return NextResponse.json({ success: false, message: "GitHub 登录尚未配置，请联系管理员。" }, { status: 503 });
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(getGitHubAuthorizationUrl(request, state));
  const next = new URL(request.url).searchParams.get("next") || "/";
  response.cookies.set("datatalk-github-state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/github", maxAge: 10 * 60 });
  response.cookies.set("datatalk-github-next", next, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/github", maxAge: 10 * 60 });
  return response;
}
