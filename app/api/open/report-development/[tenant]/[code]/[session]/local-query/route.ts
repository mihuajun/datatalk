import { apiErrorResponse, assertSameOrigin, OpenApiError } from "@/lib/server/open-api-auth";
import { queryForLocalPreview } from "@/lib/server/report-development";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ tenant: string; code: string; session: string }> }) {
  try {
    assertSameOrigin(request);
    const { tenant, code, session } = await context.params;
    if (!/^[1-9][0-9]*$/.test(tenant) || !Number.isSafeInteger(Number(tenant)) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code)) throw new OpenApiError("DEVELOPMENT_NOT_FOUND", 404, "开发会话不存在");
    const chunks: Uint8Array[] = []; let size = 0;
    if (!request.body) throw new OpenApiError("INVALID_ARGUMENTS", 400, "缺少查询参数");
    for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length; if (size > 65536) throw new OpenApiError("BODY_TOO_LARGE", 413, "查询参数超过64KB"); chunks.push(chunk);
    }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new OpenApiError("INVALID_ARGUMENTS", 400, "查询参数无效"); }
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.get("authorization") || "")?.[1] || "";
    return Response.json(await queryForLocalPreview(Number(tenant), code, session, token, body), { headers: { "Cache-Control": "private, no-store" } });
  } catch(e) { return apiErrorResponse(e); }
}
