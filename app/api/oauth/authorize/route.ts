import { getAuthSession } from "@/lib/server/auth-session";
import { resolveConsent, readOAuthBody, oauthErrorResponse, OAuthError, studioRequestOrigin } from "@/lib/server/studio-oauth";
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== studioRequestOrigin(request)) throw new OAuthError("invalid_request", "请在工作台授权页面操作", 403);
    const session = await getAuthSession();
    if (!session) throw new OAuthError("access_denied", "请先登录工作台", 401);
    const body = await readOAuthBody(request);
    if (typeof body.request_id !== "string" || !["approve","deny"].includes(String(body.decision))) throw new OAuthError("invalid_request", "授权请求无效");
    const target = await resolveConsent(body.request_id, session, body.decision === "approve");
    return new Response(null, { status:303, headers:{ Location:target, "Cache-Control":"no-store", "Referrer-Policy":"no-referrer" } });
  } catch(e) { return oauthErrorResponse(e); }
}
