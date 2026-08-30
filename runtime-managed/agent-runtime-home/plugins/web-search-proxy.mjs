import { defineTool } from "../../deepseek-harness/node_modules/@deepseek-ai/dsh-tools/lib/index.js";

export const name = "web-search-proxy";
export const inject = ["tools"];

function resolveBaseUrl() {
  const value = (process.env.REPORT_AGENT_TOOLS_BASE_URL || "").trim().replace(/\/+$/, "");
  if (value) return value;
  const port = (process.env.PORT || "3000").trim();
  return `http://127.0.0.1:${port}`;
}

function resolveProxyToken() {
  return (process.env.REPORT_AGENT_RUNTIME_PROXY_TOKEN || "").trim();
}

function jsonText(value) {
  return [{ type: "text", text: JSON.stringify(value) }];
}

async function callWebSearch(args, exec) {
  const dshSessionId = exec.agent?.id;
  if (!dshSessionId) throw new Error("REPORT_AGENT_TOOL_SESSION_NOT_FOUND");

  const proxyToken = resolveProxyToken();
  if (!proxyToken) throw new Error("WEB_SEARCH_PROXY_NOT_CONFIGURED");

  const response = await fetch(`${resolveBaseUrl()}/api/internal/web-search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-report-agent-dsh-session-id": dshSessionId,
      "x-report-agent-runtime-proxy-token": proxyToken,
    },
    body: JSON.stringify({
      query: args.query,
      type: args.type,
      count: args.count,
      timeRange: args.timeRange,
      authLevel: args.authLevel,
      queryRewrite: args.queryRewrite,
    }),
    signal: exec.signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.message === "string" ? payload.message : `HTTP_${response.status}`);
  }
  return payload.result;
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "datatalk-web-search",
    description: "通过宿主服务代理执行联网搜索。宿主服务负责凭证和上游请求，调用方不需要也不能提供 API Key。",
    parameters: {
      query: { type: "string", required: true, description: "搜索关键词，最多 100 个字符。" },
      type: { type: "string", description: "搜索类型：web（默认）或 image。" },
      count: { type: "integer", description: "返回条数；web 最多 50，image 最多 5，默认 10。" },
      timeRange: { type: "string", description: "web 可选时间范围：OneDay、OneWeek、OneMonth、OneYear，或 YYYY-MM-DD..YYYY-MM-DD。" },
      authLevel: { type: "integer", description: "web 可选权威度过滤，填写 0 或 1。" },
      queryRewrite: { type: "boolean", description: "是否让搜索服务改写查询词。" },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => jsonText(value),
    },
    async execute(args, exec) {
      return callWebSearch(args, exec);
    },
  }));
}
