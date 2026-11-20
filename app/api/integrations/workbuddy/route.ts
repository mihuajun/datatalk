import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/server/auth-session";
import { OAuthError, oauthErrorResponse, studioRequestOrigin } from "@/lib/server/studio-oauth";
import { beginWorkBuddyBinding, disconnectWorkBuddy, workBuddyStatus, WORKBUDDY_CALLBACK_PATH, WORKBUDDY_STATE_COOKIE } from "@/lib/server/workbuddy-oauth";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request) {
  try {
    const session = await getAuthSession();
    if (!session) throw new OAuthError("unauthenticated", "请先登录 DataTalk Studio", 401);
    const origin = studioRequestOrigin(request);
    return Response.json({ ...await workBuddyStatus(session), callbackUrl: `${origin}${WORKBUDDY_CALLBACK_PATH}` }, { headers });
  } catch (error) { return oauthErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const origin = studioRequestOrigin(request);
    if (request.headers.get("origin") !== origin) throw new OAuthError("invalid_request", "请从 Studio 页面发起绑定", 403);
    const session = await getAuthSession();
    if (!session) throw new OAuthError("unauthenticated", "请先登录 DataTalk Studio", 401);
    const started = await beginWorkBuddyBinding(session, origin);
    const response = NextResponse.json({ url: started.url }, { headers });
    response.cookies.set(WORKBUDDY_STATE_COOKIE, started.browserNonce, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/api/integrations/workbuddy", maxAge: 600 });
    return response;
  } catch (error) { return oauthErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    if (request.headers.get("origin") !== studioRequestOrigin(request)) throw new OAuthError("invalid_request", "请从 Studio 页面解除绑定", 403);
    const session = await getAuthSession();
    if (!session) throw new OAuthError("unauthenticated", "请先登录 DataTalk Studio", 401);
    await disconnectWorkBuddy(session);
    const response = NextResponse.json({ disconnected: true }, { headers });
    response.cookies.set(WORKBUDDY_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/integrations/workbuddy", maxAge: 0 });
    return response;
  } catch (error) { return oauthErrorResponse(error); }
}
