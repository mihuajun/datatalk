import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { authCookieOptions, encodeAuthSession } from "@/lib/server/auth-session";
import { findOrCreateGoogleUser, getGoogleRedirectUri } from "@/lib/server/google-auth";
import { safeReturnTo } from "@/lib/server/safe-return-to";
import { isRegistrationEnabled } from "@/lib/server/auth-config";

export async function GET(request: Request) {
  if (!isRegistrationEnabled()) return NextResponse.json({ success: false, message: "第三方登录功能已关闭。" }, { status: 403 });
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const cookieHeader = request.headers.get("cookie") || "";
  const savedState = cookieHeader.match(/(?:^|;\s*)datatalk-google-state=([^;]+)/)?.[1];
  const savedNext = cookieHeader.match(/(?:^|;\s*)datatalk-google-next=([^;]+)/)?.[1];
  const publicOrigin = new URL(getGoogleRedirectUri(request)).origin;
  const failure = (message: string) => NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(message)}`, publicOrigin));
  if (!code || !state || !savedState || state !== decodeURIComponent(savedState)) return failure("Google 授权已失效，请重新登录。");
  try {
    const user = await findOrCreateGoogleUser(request, code);
    const next = safeReturnTo(savedNext ? decodeURIComponent(savedNext) : url.searchParams.get("next"));
    const response = NextResponse.redirect(new URL(next, publicOrigin));
    response.cookies.set(AUTH_COOKIE_NAME, encodeAuthSession(user), authCookieOptions());
    response.cookies.set("datatalk-last-login-method", "google", { ...authCookieOptions(), httpOnly: false, maxAge: 365 * 24 * 60 * 60 });
    response.cookies.delete("datatalk-google-state");
    response.cookies.delete("datatalk-google-next");
    return response;
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    const message = error instanceof Error && error.message === "GOOGLE_USER_DISABLED" ? "该账号已被禁用，请联系管理员。" : error instanceof Error && error.message === "GOOGLE_EMAIL_UNVERIFIED" ? "Google 账号没有可用的已验证邮箱。" : "Google 登录失败，请稍后重试。";
    return failure(message);
  }
}
