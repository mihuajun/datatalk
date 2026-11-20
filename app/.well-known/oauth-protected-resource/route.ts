import { studioRequestOrigin, oauthErrorResponse } from "@/lib/server/studio-oauth";
export async function GET(request: Request) {
  try {
    const origin = studioRequestOrigin(request);
    // This unqualified well-known URL describes the origin-root resource.
    // The MCP endpoint has its own path-qualified metadata route below.
    return Response.json({
      resource: origin,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["studio"],
      resource_name: "数问·分析工作台",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return oauthErrorResponse(e); }
}
