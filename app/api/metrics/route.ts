import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { deleteMetricKnowledgeManagement, listMetricKnowledgeForManagement, listMetricKnowledgeHistory, listMetricKnowledgeProposals, updateMetricKnowledgeManagement } from "@/lib/server/report-metric-knowledge-service";

export async function GET(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const searchParams = new URL(request.url).searchParams;
  const keyword = searchParams.get("keyword") || "";
  const status = searchParams.get("status") || "all";
  const historyMetricKey = searchParams.get("history");

  try {
    if (historyMetricKey) {
      return NextResponse.json({ history: await listMetricKnowledgeHistory(session.tenantId, historyMetricKey) });
    }
    const [metrics, proposals] = await Promise.all([
      listMetricKnowledgeForManagement(session.tenantId, { keyword, status, limit: 100 }),
      listMetricKnowledgeProposals(session.tenantId, { keyword, limit: 100 }),
    ]);
    return NextResponse.json({ metrics: metrics.items, proposals: proposals.items });
  } catch (error) {
    console.error("List metric semantics failed", error);
    return NextResponse.json({ message: "指标语义暂时不可用，请稍后重试" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ message: "请求内容无效" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ message: "请求内容无效" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const metricKey = typeof input.metricKey === "string" ? input.metricKey.trim() : "";
  const update: { status?: "active" | "disabled" | "archived" } = {};
  if (!metricKey || metricKey.length > 100) return NextResponse.json({ message: "指标标识无效" }, { status: 400 });
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "disabled" && input.status !== "archived") return NextResponse.json({ message: "指标状态无效" }, { status: 400 });
    update.status = input.status;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ message: "没有需要更新的管理字段" }, { status: 400 });
  if (!update.status) return NextResponse.json({ message: "没有需要更新的管理字段" }, { status: 400 });

  try {
    const updated = await updateMetricKnowledgeManagement(session.tenantId, metricKey, session.userId, { status: update.status! });
    if (!updated) return NextResponse.json({ message: "指标不存在" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Update metric semantics management fields failed", error);
    return NextResponse.json({ message: "指标管理信息更新失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ message: "请求内容无效" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ message: "请求内容无效" }, { status: 400 });
  }
  const metricKey = typeof (body as Record<string, unknown>).metricKey === "string"
    ? ((body as Record<string, unknown>).metricKey as string).trim()
    : "";
  if (!metricKey || metricKey.length > 100) return NextResponse.json({ message: "指标标识无效" }, { status: 400 });

  try {
    const deleted = await deleteMetricKnowledgeManagement(session.tenantId, metricKey, session.userId);
    if (!deleted) return NextResponse.json({ message: "仅已归档且无在用报表引用的指标可以删除" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete metric semantics failed", error);
    return NextResponse.json({ message: "指标删除失败，请稍后重试" }, { status: 500 });
  }
}
