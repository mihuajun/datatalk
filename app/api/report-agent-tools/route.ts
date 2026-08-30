import { NextResponse } from "next/server";

import { authorizeReportAgentSessionBinding, markReportAgentSqlPreviewSuccess } from "@/lib/server/report-agent-session-binding";
import { type ReportAgentToolScope } from "@/lib/server/report-agent-tool-auth";
import {
  getReportAgentDataSourceSchema,
  listReportAgentDataSources,
  listReportAgentReferenceReports,
  previewReportAgentSql,
  readReportAgentReferenceReport,
} from "@/lib/server/report-agent-tools";
import { proposeMetricKnowledge, recordMetricFeedback, searchMetricKnowledge } from "@/lib/server/report-metric-knowledge-service";
import { normalizeReportQueryError } from "@/lib/server/report-query-gateway";
import { getReportDetailByCode } from "@/lib/server/report-repository";

type ToolName =
  | "list_data_sources"
  | "get_data_source_schema"
  | "preview_sql"
  | "list_reference_reports"
  | "read_reference_report"
  | "search_metric_knowledge"
  | "propose_metric_knowledge"
  | "record_metric_feedback";

function toolScope(tool: ToolName): ReportAgentToolScope {
  if (tool === "get_data_source_schema") return "schema:read";
  if (tool === "preview_sql") return "sql:preview";
  if (tool === "list_reference_reports" || tool === "read_reference_report") return "report:read";
  if (tool === "search_metric_knowledge") return "metric:read";
  if (tool === "propose_metric_knowledge") return "metric:propose";
  if (tool === "record_metric_feedback") return "metric:feedback";
  return "datasource:list";
}

function parseSessionId(request: Request) {
  return (request.headers.get("x-report-agent-dsh-session-id") || "").trim();
}

function errorStatus(code: string) {
  const queryCode = code.match(/^QUERY_[A-Z_]+/)?.[0] || code;
  if (
    code === "REPORT_AGENT_TOOL_UNAUTHORIZED"
    || code === "REPORT_AGENT_TOOL_TOKEN_EXPIRED"
    || code === "REPORT_AGENT_TOOL_SESSION_NOT_FOUND"
  ) {
    return 401;
  }
  if (code === "REPORT_AGENT_TOOL_FORBIDDEN") return 403;
  if (code === "METRIC_NOT_FOUND" || code === "REPORT_AGENT_REFERENCE_NOT_FOUND") return 404;
  if (queryCode === "QUERY_CONNECTION_FAILED") return 503;
  if (
    code === "DATA_SOURCE_REF_REQUIRED" ||
    code === "REPORT_AGENT_TOOL_SQL_REQUIRED" ||
    code === "REPORT_AGENT_TOOL_INVALID_PARAMS" ||
    code === "REPORT_AGENT_REFERENCE_REPORT_REQUIRED" ||
    code === "REPORT_AGENT_REFERENCE_FILE_INVALID" ||
    code === "REPORT_AGENT_REFERENCE_FILE_LIMIT" ||
    code === "REPORT_AGENT_REFERENCE_CONTENT_TOO_LARGE" ||
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
    code === "METRIC_QUERY_REQUIRED" ||
    code === "METRIC_NAME_REQUIRED" ||
    code === "METRIC_DEFINITION_REQUIRED" ||
    code === "METRIC_FORMULA_REQUIRED" ||
    code === "METRIC_SOURCE_REF_REQUIRED" ||
    code === "METRIC_KEY_REQUIRED" ||
    code === "METRIC_FEEDBACK_INVALID" ||
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { tool?: unknown; args?: Record<string, unknown> };
  const tool = body.tool;
  if (
    tool !== "list_data_sources"
    && tool !== "get_data_source_schema"
    && tool !== "preview_sql"
    && tool !== "list_reference_reports"
    && tool !== "read_reference_report"
    && tool !== "search_metric_knowledge"
    && tool !== "propose_metric_knowledge"
    && tool !== "record_metric_feedback"
  ) {
    return NextResponse.json({ message: "tool 不正确" }, { status: 400 });
  }

  try {
    const binding = authorizeReportAgentSessionBinding({
      dshSessionId: parseSessionId(request),
      scope: toolScope(tool),
    });

    const report = await getReportDetailByCode(binding.tenantId, binding.reportCode);
    if (!report) return NextResponse.json({ message: "报表不存在" }, { status: 404 });

    if (tool === "list_data_sources") {
      return NextResponse.json({
        ok: true,
        result: { items: await listReportAgentDataSources(binding.tenantId) },
      });
    }

    if (tool === "get_data_source_schema") {
      return NextResponse.json({
        ok: true,
        result: await getReportAgentDataSourceSchema({
          tenantId: binding.tenantId,
          dataSourceRef: typeof body.args?.dataSource === "string" ? body.args.dataSource : "",
          keyword: typeof body.args?.keyword === "string" ? body.args.keyword : "",
          tables: body.args?.tables,
          limit: typeof body.args?.limit === "number" ? body.args.limit : Number(body.args?.limit),
        }),
      });
    }

    if (tool === "list_reference_reports") {
      return NextResponse.json({
        ok: true,
        result: await listReportAgentReferenceReports({
          tenantId: binding.tenantId,
          currentReportCode: binding.reportCode,
          keyword: typeof body.args?.keyword === "string" ? body.args.keyword : "",
          limit: typeof body.args?.limit === "number" ? body.args.limit : Number(body.args?.limit),
        }),
      });
    }

    if (tool === "read_reference_report") {
      return NextResponse.json({
        ok: true,
        result: await readReportAgentReferenceReport({
          tenantId: binding.tenantId,
          reportCode: typeof body.args?.reportCode === "string" ? body.args.reportCode : "",
          files: body.args?.files,
        }),
      });
    }

    if (tool === "search_metric_knowledge") {
      return NextResponse.json({
        ok: true,
        result: await searchMetricKnowledge(binding.tenantId, {
          query: typeof body.args?.query === "string" ? body.args.query : "",
          formulaHint: typeof body.args?.formulaHint === "string" ? body.args.formulaHint : undefined,
          timeFieldHint: typeof body.args?.timeFieldHint === "string" ? body.args.timeFieldHint : undefined,
          filters: body.args?.filters,
          dedupRule: typeof body.args?.dedupRule === "string" ? body.args.dedupRule : undefined,
          dataSource: typeof body.args?.dataSource === "string" ? body.args.dataSource : undefined,
          limit: typeof body.args?.limit === "number" ? body.args.limit : Number(body.args?.limit),
        }),
      });
    }

    if (tool === "propose_metric_knowledge") {
      return NextResponse.json({
        ok: true,
        result: await proposeMetricKnowledge({
          tenantId: binding.tenantId,
          reportCode: binding.reportCode,
          conversationId: binding.conversationId,
          dshSessionId: binding.dshSessionId,
          userId: binding.userId,
          sqlPreviewValidated: binding.sqlPreviewSuccessCount > 0,
          metricKey: body.args?.metricKey,
          name: body.args?.name,
          aliases: body.args?.aliases,
          definition: body.args?.definition,
          formula: body.args?.formula,
          grain: body.args?.grain,
          timeField: body.args?.timeField,
          filters: body.args?.filters,
          dedupRule: body.args?.dedupRule,
          dataSource: body.args?.dataSource,
          sourceRef: body.args?.sourceRef,
          confirmed: body.args?.confirmed,
        }),
      });
    }

    if (tool === "record_metric_feedback") {
      return NextResponse.json({
        ok: true,
        result: await recordMetricFeedback({
          tenantId: binding.tenantId,
          reportCode: binding.reportCode,
          conversationId: binding.conversationId,
          userId: binding.userId,
          metricKey: body.args?.metricKey,
          action: body.args?.action,
          reason: body.args?.reason,
          before: body.args?.before,
          after: body.args?.after,
        }),
      });
    }

    const result = await previewReportAgentSql({
      tenantId: binding.tenantId,
      dataSourceRef: typeof body.args?.dataSource === "string" ? body.args.dataSource : "",
      sql: typeof body.args?.sql === "string" ? body.args.sql : "",
      params: body.args?.params,
      maxRows: typeof body.args?.maxRows === "number" ? body.args.maxRows : Number(body.args?.maxRows),
    });
    markReportAgentSqlPreviewSuccess(binding.dshSessionId);
    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : normalizeReportQueryError(error);
    if (errorStatus(message) >= 500) {
      console.error("Report agent tool request failed", { error });
    }
    return NextResponse.json({ message }, { status: errorStatus(message) });
  }
}
