import { getAuthSession } from "@/lib/server/auth-session";
import { apiErrorResponse, assertSameOrigin, OpenApiError, readApiKeySecret } from "@/lib/server/open-api-auth";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthSession();
    if (!session) throw new OpenApiError("UNAUTHENTICATED", 401, "请先登录 Studio");
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id < 1) throw new OpenApiError("INVALID_ID", 400, "API Key ID 无效");
    return Response.json({ secret: await readApiKeySecret(session, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
