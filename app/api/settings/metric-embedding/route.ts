import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/server/mysql";
import { NextResponse } from "next/server";
import { getAuthSession, isAdministratorSession } from "@/lib/server/auth-session";
import { publicMetricEmbeddingConfig, prepareMetricEmbeddingConfig, saveMetricEmbeddingConfig } from "@/lib/server/metric-embedding-config";
import { MetricEmbeddingError, embedMetricText, rebuildMetricSearchIndex } from "@/lib/server/metric-retrieval";
import { ensureDatabaseBootstrap } from "@/lib/server/database-bootstrap";
export async function GET() {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  if (!isAdministratorSession(session)) return NextResponse.json({ message: "无权限" }, { status: 403 });
  return NextResponse.json({ config: publicMetricEmbeddingConfig() });
}
export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  if (!isAdministratorSession(session)) return NextResponse.json({ message: "无权限" }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ message: "请求来源不匹配" }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === "reindex") {
      await ensureDatabaseBootstrap();
      const result = await rebuildMetricSearchIndex(session.tenantId);
      if (result.status === "not_configured") return NextResponse.json({ result, message: "向量检索未启用，未发起索引请求" });
      if (result.indexed === 0 && result.failed === 0) {
        const [rows] = await getDbPool().query<Array<RowDataPacket & { candidate_count: number }>>(
          "SELECT COUNT(*) AS candidate_count FROM report_metric_knowledge_proposal WHERE tenant_id=? AND status IN ('pending','draft','rejected')", [session.tenantId],
        );
        const candidateCount = Number(rows[0]?.candidate_count || 0);
        return NextResponse.json({ result: { ...result, status: "empty", candidateCount }, message: `当前租户没有可建立索引的有效指标，未调用向量服务。${candidateCount ? `另有 ${candidateCount} 条候选记录，需完成口径确认、SQL 校验及报表提交后成为正式指标，才能建立索引。` : "候选草稿、已归档及已删除指标不参与索引。"}` });
      }
      return NextResponse.json({ result, message: `索引完成：处理 ${result.indexed + result.failed} 个有效指标，成功 ${result.indexed}，失败 ${result.failed}` });
    }
    if (body.action === "test") {
      const config = prepareMetricEmbeddingConfig({ ...body, enabled: true });
      const result = await embedMetricText("指标语义连接测试", config);
      return NextResponse.json({ message: `连接成功，向量维度 ${result.vector.length}。测试不会保存配置或启用检索。` });
    }
    if (body.action !== "save") throw new Error("不支持的操作");
    return NextResponse.json({ config: saveMetricEmbeddingConfig(body), message: "配置已保存并立即生效；更换模型后请重建当前租户索引" });
  } catch (error) {
    if (error instanceof MetricEmbeddingError) {
      console.warn("Metric embedding connection failed", { code: error.code, upstreamStatus: error.status, providerCode: error.providerCode });
      return NextResponse.json({ message: error.message, code: error.code, upstreamStatus: error.status }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "操作失败";
    return NextResponse.json({ message: message.startsWith("EMBEDDING_") || message.includes("fetch") ? "向量服务连接失败，请检查地址、模型和密钥" : message }, { status: 400 });
  }
}
