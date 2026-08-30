import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { type ReportAgentToolScope, verifyReportAgentToolToken } from "@/lib/server/report-agent-tool-auth";
import { getReportAgentDataSourceSchema, listReportAgentDataSources, previewReportAgentSql } from "@/lib/server/report-agent-tools";
import { normalizeReportQueryError } from "@/lib/server/report-query-gateway";
import { getReportDetailByCode } from "@/lib/server/report-repository";

type ToolName = "list_data_sources" | "get_data_source_schema" | "preview_sql";

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function toolScope(tool: ToolName): ReportAgentToolScope {
  if (tool === "get_data_source_schema") return "schema:read";
  if (tool === "preview_sql") return "sql:preview";
  return "datasource:list";
}

function parseBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

async function authorizeReportAgentToolRequest(request: Request, reportCode: string, scope: ReportAgentToolScope) {
  const session = await getAuthSession();
  if (session) return { tenantId: session.tenantId, userId: session.userId };

  const token = parseBearerToken(request);
  const payload = verifyReportAgentToolToken(token, { reportCode, scope });
  return { tenantId: payload.tenantId, userId: payload.userId };
}

function errorStatus(code: string) {
  const queryCode = code.match(/^QUERY_[A-Z_]+/)?.[0] || code;
  if (code === "REPORT_AGENT_TOOL_UNAUTHORIZED" || code === "REPORT_AGENT_TOOL_TOKEN_EXPIRED") return 401;
  if (code === "REPORT_AGENT_TOOL_FORBIDDEN") return 403;
  if (queryCode === "QUERY_CONNECTION_FAILED") return 503;
  if (
    code === "DATA_SOURCE_REF_REQUIRED" ||
    code === "REPORT_AGENT_TOOL_SQL_REQUIRED" ||
    code === "REPORT_AGENT_TOOL_INVALID_PARAMS" ||
    code === "QUERY_REJECTED" ||
    code === "QUERY_PARAMETER_MISSING" ||
    code === "QUERY_PARAMETER_INVALID" ||
    code === "QUERY_TIMEOUT" ||
    code === "QUERY_RESULT_LIMIT" ||
    code === "DATA_SOURCE_NOT_SUPPORTED" ||
    code === "DATA_SOURCE_DATABASE_REQUIRED" ||
    code === "DATA_SOURCE_NOT_FOUND" ||
    code === "REST_CONFIG_INVALID" ||
    code === "REST_REQUEST_INVALID" ||
    code === "REST_REQUEST_FAILED" ||
    code === "REST_RESPONSE_INVALID" ||
    queryCode === "QUERY_AUTH_FAILED" ||
    queryCode === "QUERY_DATABASE_NOT_FOUND" ||
    queryCode === "QUERY_PERMISSION_DENIED" ||
    queryCode === "QUERY_SYNTAX_ERROR" ||
    queryCode === "QUERY_COLUMN_NOT_FOUND" ||
    queryCode === "QUERY_TABLE_NOT_FOUND"
  ) {
    return 400;
  }
  return 500;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  const body = await request.json().catch(() => ({})) as { tool?: unknown; args?: Record<string, unknown> };
  const tool = body.tool;
  if (tool !== "list_data_sources" && tool !== "get_data_source_schema" && tool !== "preview_sql") {
    return NextResponse.json({ message: "tool 不正确" }, { status: 400 });
  }

  try {
    const auth = await authorizeReportAgentToolRequest(request, reportCode, toolScope(tool));
    const report = await getReportDetailByCode(auth.tenantId, reportCode);
    if (!report) return NextResponse.json({ message: "报表不存在" }, { status: 404 });

    if (tool === "list_data_sources") {
      return NextResponse.json({
        ok: true,
        result: { items: await listReportAgentDataSources(auth.tenantId) },
      });
    }

    if (tool === "get_data_source_schema") {
      return NextResponse.json({
        ok: true,
        result: await getReportAgentDataSourceSchema({
          tenantId: auth.tenantId,
          dataSourceRef: typeof body.args?.dataSource === "string" ? body.args.dataSource : "",
          keyword: typeof body.args?.keyword === "string" ? body.args.keyword : "",
          tables: body.args?.tables,
          limit: typeof body.args?.limit === "number" ? body.args.limit : Number(body.args?.limit),
        }),
      });
    }

    return NextResponse.json({
      ok: true,
      result: await previewReportAgentSql({
        tenantId: auth.tenantId,
        dataSourceRef: typeof body.args?.dataSource === "string" ? body.args.dataSource : "",
        sql: typeof body.args?.sql === "string" ? body.args.sql : "",
        params: body.args?.params,
        maxRows: typeof body.args?.maxRows === "number" ? body.args.maxRows : Number(body.args?.maxRows),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : normalizeReportQueryError(error);
    if (errorStatus(message) >= 500) {
      console.error("Report agent tool request failed", { reportCode, error });
    }
    return NextResponse.json({ message }, { status: errorStatus(message) });
  }
}
