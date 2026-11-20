import { getAuthSession } from "@/lib/server/auth-session";
import { apiErrorResponse, assertSameOrigin, deleteApiKey, OpenApiError } from "@/lib/server/open-api-auth";
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getAuthSession();
    if (!session) throw new OpenApiError("UNAUTHENTICATED", 401, "请先登录 Studio");
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id < 1) throw new OpenApiError("INVALID_ID", 400, "Key ID 无效");
    await deleteApiKey(session, id);
    return Response.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
