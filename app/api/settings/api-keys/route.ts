import { getAuthSession } from "@/lib/server/auth-session";
import { apiErrorResponse, assertSameOrigin, createApiKey, listApiKeys, OpenApiError, readApiJson } from "@/lib/server/open-api-auth";
export const runtime = "nodejs";
export async function GET() {
  try {
    const session = await getAuthSession();
    if (!session) throw new OpenApiError("UNAUTHENTICATED", 401, "请先登录 Studio");
    return Response.json({ keys: await listApiKeys(session) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getAuthSession();
    if (!session) throw new OpenApiError("UNAUTHENTICATED", 401, "请先登录 Studio");
    const body = await readApiJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new OpenApiError("INVALID_ARGUMENTS", 400, "请填写 Key 配置");
    return Response.json(await createApiKey(session, body), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
