import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { encodeAuthSession } from "@/lib/server/auth-session";
import { findOrCreateGitHubUser, getGitHubRedirectUri } from "@/lib/server/github-auth";
import { safeReturnTo } from "@/lib/server/safe-return-to";
import { isRegistrationEnabled } from "@/lib/server/auth-config";

export async function GET(request: Request) {
  if (!isRegistrationEnabled()) return NextResponse.json({ success: false, message: "第三方登录功能已关闭。" }, { status: 403 });
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const savedState = request.headers.get("cookie")?.match(/(?:^|;\s*)datatalk-github-state=([^;]+)/)?.[1];
  const savedNext = request.headers.get("cookie")?.match(/(?:^|;\s*)datatalk-github-next=([^;]+)/)?.[1];
  const publicOrigin = new URL(getGitHubRedirectUri(request)).origin;
  const failure = (message: string) => NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(message)}`, publicOrigin));
  if (!code || !state || !savedState || state !== decodeURIComponent(savedState)) return failure("GitHub 授权已失效，请重新登录。");
  try {
    const user = await findOrCreateGitHubUser(request, code);
    const response = NextResponse.redirect(new URL(safeReturnTo(savedNext ? decodeURIComponent(savedNext) : url.searchParams.get("next")), publicOrigin));
    response.cookies.set(AUTH_COOKIE_NAME, encodeAuthSession(user), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24, ...(process.env.AUTH_COOKIE_DOMAIN?.trim() ? { domain: process.env.AUTH_COOKIE_DOMAIN.trim() } : {}) });
    response.cookies.set("datatalk-last-login-method", "github", { httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 24 * 60 * 60 });
    response.cookies.delete("datatalk-github-state");
    response.cookies.delete("datatalk-github-next");
    return response;
  } catch (error) {
    console.error("GitHub OAuth callback failed", error);
    return failure(error instanceof Error && error.message === "GITHUB_USER_DISABLED" ? "该账号已被禁用，请联系管理员。" : "GitHub 登录失败，请稍后重试。");
  }
}
