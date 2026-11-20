import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthSession, encodeAuthSession } from "@/lib/server/auth-session";
import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { OAuthError, oauthErrorResponse, studioRequestOrigin } from "@/lib/server/studio-oauth";
import { finishWorkBuddyBinding, readWorkBuddyProfile, WORKBUDDY_STATE_COOKIE, finishWorkBuddyLogin, WORKBUDDY_LOGIN_COOKIE, WorkBuddyLoginError } from "@/lib/server/workbuddy-oauth";

export const runtime = "nodejs";
export async function GET(request: Request) {
  let origin: string;
  try { origin = studioRequestOrigin(request); }
  catch (error) { return oauthErrorResponse(error); }
  const params = new URL(request.url).searchParams;
  if (params.get("state")?.startsWith("login.")) {
    let response: NextResponse;
    try {
      // An account signed in in another tab must not be silently replaced or linked.
      if (await getAuthSession()) throw new OAuthError("account_changed", "Studio 账号状态已变化，请返回后继续");
      const login = await finishWorkBuddyLogin(origin, params, (await cookies()).get(WORKBUDDY_LOGIN_COOKIE)?.value || "");
      response = NextResponse.redirect(new URL(login.returnTo, origin), 303);
      response.cookies.set(AUTH_COOKIE_NAME, encodeAuthSession(login.user), { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 86400, ...(process.env.AUTH_COOKIE_DOMAIN?.trim() ? { domain: process.env.AUTH_COOKIE_DOMAIN.trim() } : {}) });
      response.cookies.set("datatalk-last-login-method", "workbuddy", { secure: origin.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 31536000 });
    } catch (error) {
      const target = new URL("/", origin);
      const code = error instanceof OAuthError ? error.code : "login_failed";
      target.searchParams.set("workbuddy_login", ["access_denied", "invalid_state", "not_configured", "identity_conflict", "account_disabled", "account_changed"].includes(code) ? code : "login_failed");
      if (error instanceof WorkBuddyLoginError) target.searchParams.set("next", error.returnTo);
      response = NextResponse.redirect(target, 303);
    }
    response.cookies.set(WORKBUDDY_LOGIN_COOKIE, "", { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/api/integrations/workbuddy", maxAge: 0 });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  let result = "failed";
  try {
    const session = await getAuthSession();
    if (!session) throw new OAuthError("unauthenticated", "登录已过期，请登录后重新绑定", 401);
    await finishWorkBuddyBinding(session, origin, new URL(request.url).searchParams, (await cookies()).get(WORKBUDDY_STATE_COOKIE)?.value || "");
    result = "connected";
    // A profile outage should not discard a successfully established binding.
    try { await readWorkBuddyProfile(session); }
    catch { result = "profile_pending"; }
  } catch (error) {
    if (error instanceof OAuthError && ["access_denied", "invalid_state", "unauthenticated", "not_configured", "identity_conflict"].includes(error.code)) result = error.code;
  }
  const target = new URL("/api-management", origin);
  target.searchParams.set("workbuddy", result);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(WORKBUDDY_STATE_COOKIE, "", { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/api/integrations/workbuddy", maxAge: 0 });
  return response;
}
