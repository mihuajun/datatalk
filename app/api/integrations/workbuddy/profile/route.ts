import { getAuthSession } from "@/lib/server/auth-session";
import { OAuthError, oauthErrorResponse, studioRequestOrigin } from "@/lib/server/studio-oauth";
import { readWorkBuddyProfile } from "@/lib/server/workbuddy-oauth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== studioRequestOrigin(request)) throw new OAuthError("invalid_request", "请从 Studio 页面操作", 403);
    const session = await getAuthSession();
    if (!session) throw new OAuthError("unauthenticated", "请先登录 DataTalk Studio", 401);
    return Response.json(await readWorkBuddyProfile(session), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return oauthErrorResponse(error); }
}
