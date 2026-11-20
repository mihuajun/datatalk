import type { RowDataPacket } from "mysql2/promise";
import { getAuthSession } from "@/lib/server/auth-session";
import { apiErrorResponse, OpenApiError } from "@/lib/server/open-api-auth";
import { getDbPool } from "@/lib/server/mysql";
import { ensureConnectionSchema } from "@/lib/server/studio-connection-schema";
export async function GET() {
  try {
    const session = await getAuthSession();
    if (!session) throw new OpenApiError("UNAUTHENTICATED", 401, "请先登录 Studio");
    await ensureConnectionSchema();
    const [rows] = await getDbPool().query<Array<RowDataPacket & { id: number; key_name: string; tool: string; report_code: string | null; status: string; created_at: string }>>(
      "SELECT l.id,CASE WHEN l.oauth_grant_id IS NOT NULL THEN 'OAuth 授权' ELSE COALESCE(k.name, '已删除的 Key') END AS key_name,l.tool,l.report_code,l.status,l.created_at FROM studio_api_log l LEFT JOIN studio_api_key k ON k.id=l.key_id AND k.tenant_id=l.tenant_id AND k.user_id=l.user_id WHERE l.tenant_id=? AND l.user_id=? ORDER BY l.id DESC LIMIT 50", [session.tenantId, session.userId]);
    return Response.json({ logs: rows.map(r => ({ id: Number(r.id), keyName: r.key_name, tool: r.tool, reportCode: r.report_code, status: r.status, createdAt: r.created_at })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
