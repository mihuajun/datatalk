import { STUDIO_MCP_VERSION, STUDIO_MCP_INSTRUCTIONS } from "@/lib/server/studio-mcp-contract";
import { studioRequestOrigin } from "@/lib/server/studio-oauth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { apiBaseUrl, authenticateApiRequest, assertSameOrigin, apiErrorResponse, OpenApiError } from "@/lib/server/open-api-auth";
import { STUDIO_TOOLS, invokeStudioTool } from "@/lib/server/open-api-tools";
import { isResourceCenterEnabled } from "@/lib/server/resource-center-config";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const principal = await authenticateApiRequest(request);
    const server = new McpServer({ name: "datatalk-studio", version: STUDIO_MCP_VERSION }, { instructions: STUDIO_MCP_INSTRUCTIONS });
    for (const [name, tool] of Object.entries(STUDIO_TOOLS)) {
      if (!isResourceCenterEnabled() && ["list_resource_categories", "publish_to_resource_center", "list_public_resources", "copy_public_resource"].includes(name)) continue;
      if (tool.scope && !principal.scopes.includes(tool.scope)) continue;
      server.registerTool(name, { description: tool.description, inputSchema: z.object(tool.shape).strict(), annotations: { readOnlyHint: !["begin_report_development", "inspect_report_development", "commit_report_development", "close_report_development", "propose_metric_knowledge", "create_report", "rename_report", "copy_report", "copy_public_resource", "apply_report_changes", "publish_report", "publish_to_resource_center", "configure_report_public_link"].includes(name), destructiveHint: ["commit_report_development", "close_report_development", "apply_report_changes", "publish_report", "publish_to_resource_center", "configure_report_public_link"].includes(name), openWorldHint: false } }, async (args) => {
        try {
          const result = await invokeStudioTool(principal, name, args, apiBaseUrl(request));
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }], ...(result !== null && typeof result === "object" && !Array.isArray(result) ? { structuredContent: result as Record<string, unknown> } : {}) };
        } catch (error) {
          const value = error instanceof OpenApiError ? error : new OpenApiError("INTERNAL_ERROR", 500, "服务暂时不可用");
          return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: { code: value.code, message: value.message, details: value.details } }) }] };
        }
      });
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 2 * 1024 * 1024 });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request);
      // JSON mode finishes the invocation before returning; close request-local resources.
      const body = await response.text();
      return new Response(body || null, { status: response.status, headers: { ...Object.fromEntries(response.headers), "Cache-Control": "no-store" } });
    } finally { await server.close(); }
  } catch (error) { return mcpError(error, request); }
}
export async function GET(request: Request) {
  try { assertSameOrigin(request); await authenticateApiRequest(request); return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }
  catch (error) { return mcpError(error, request); }
}
export const DELETE = GET;

function mcpError(error: unknown, request: Request) {
  const response = apiErrorResponse(error);
  if (response.status === 401) {
    // The protected resource identifier is /api/mcp, so RFC 9728 discovery
    // inserts the well-known path before that resource path.
    try { response.headers.set("WWW-Authenticate", `Bearer resource_metadata="${studioRequestOrigin(request)}/.well-known/oauth-protected-resource/api/mcp", scope="studio"`); } catch { /* API Key remains usable when cloud OAuth is not configured. */ }
  }
  return response;
}
