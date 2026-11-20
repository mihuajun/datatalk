import { apiErrorResponse, assertSameOrigin, OpenApiError } from "@/lib/server/open-api-auth";
import { authorizeDevelopmentTransfer, transferDevelopmentFile } from "@/lib/server/report-development";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenant: string; code: string; session: string }> };
async function transfer(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { tenant, code, session } = await context.params;
    if (!/^[1-9][0-9]*$/.test(tenant) || !Number.isSafeInteger(Number(tenant)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code)) throw new OpenApiError("DEVELOPMENT_NOT_FOUND", 404, "开发会话不存在");
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.get("authorization") || "")?.[1] || "";
    const value = await authorizeDevelopmentTransfer(Number(tenant), code, session, token);
    const file = new URL(request.url).searchParams.get("path") || "";
    const bytes = await transferDevelopmentFile(value, file, request.method === "PUT" ? request : undefined);
    if (request.method === "PUT") return Response.json({ uploaded: true, path: file, size: bytes.length, saved: false }, { headers: { "Cache-Control": "no-store" } });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment" } });
  } catch (e) { return apiErrorResponse(e); }
}
export const GET = transfer;
export const PUT = transfer;
