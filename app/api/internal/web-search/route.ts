import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { authorizeReportAgentSessionBinding } from "@/lib/server/report-agent-session-binding";
import { searchWeb, WebSearchServiceError } from "@/lib/server/web-search-service";

function parseSessionId(request: Request) {
  return (request.headers.get("x-report-agent-dsh-session-id") || "").trim();
}

function authorizeRuntimeProxy(request: Request) {
  const configured = process.env.REPORT_AGENT_RUNTIME_PROXY_TOKEN?.trim();
  if (!configured) throw new WebSearchServiceError("WEB_SEARCH_PROXY_NOT_CONFIGURED", 503, "Web Search 代理未完成内部鉴权配置");

  const supplied = (request.headers.get("x-report-agent-runtime-proxy-token") || "").trim();
  const suppliedBuffer = Buffer.from(supplied);
  const configuredBuffer = Buffer.from(configured);
  if (suppliedBuffer.length !== configuredBuffer.length || !timingSafeEqual(suppliedBuffer, configuredBuffer)) {
    throw new Error("REPORT_AGENT_TOOL_UNAUTHORIZED");
  }

  return authorizeReportAgentSessionBinding({
    dshSessionId: parseSessionId(request),
    scope: "web:search",
  });
}

function errorStatus(error: unknown) {
  if (error instanceof WebSearchServiceError) return error.status;
  const code = error instanceof Error ? error.message : "";
  if (code === "REPORT_AGENT_TOOL_UNAUTHORIZED" || code === "REPORT_AGENT_TOOL_SESSION_NOT_FOUND" || code === "REPORT_AGENT_TOOL_TOKEN_EXPIRED") return 401;
  if (code === "REPORT_AGENT_TOOL_FORBIDDEN") return 403;
  return 500;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  try {
    const binding = authorizeRuntimeProxy(request);
    const result = await searchWeb(body, {
      rateLimitKey: `${binding.tenantId}:${binding.userId}:${binding.dshSessionId}`,
    });
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = errorStatus(error);
    if (status >= 500 && !(error instanceof WebSearchServiceError && error.code === "WEB_SEARCH_UPSTREAM_UNAVAILABLE")) {
      console.error("Web search proxy request failed", {
        code: error instanceof WebSearchServiceError ? error.code : error instanceof Error ? error.message : "UNKNOWN",
      });
    }
    if (error instanceof WebSearchServiceError) {
      return NextResponse.json({ message: error.message, code: error.code }, { status });
    }
    const message = error instanceof Error ? error.message : "Web Search 代理请求失败";
    return NextResponse.json({ message }, { status });
  }
}
