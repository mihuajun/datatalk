import { studioRequestOrigin, oauthErrorResponse } from "@/lib/server/studio-oauth";

export async function GET(request: Request) {
  try {
    const origin = studioRequestOrigin(request);
    return Response.json({
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["studio"],
      resource_name: "数问·分析工作台",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return oauthErrorResponse(e); }
}
