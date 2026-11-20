import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/server/auth-session";
import { studioRequestOrigin, oauthErrorResponse } from "@/lib/server/studio-oauth";
import { beginWorkBuddyLogin, workBuddyReturnTo, WORKBUDDY_LOGIN_COOKIE } from "@/lib/server/workbuddy-oauth";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const origin = studioRequestOrigin(request);
    const next = workBuddyReturnTo(new URL(request.url).searchParams.get("next"));
    if (await getAuthSession()) return NextResponse.redirect(new URL(next, origin), 303);
    const started = await beginWorkBuddyLogin(origin, next);
    const response = NextResponse.redirect(started.url, 303);
    response.cookies.set(WORKBUDDY_LOGIN_COOKIE, started.browserNonce, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/api/integrations/workbuddy", maxAge: 600 });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) { return oauthErrorResponse(error); }
}
