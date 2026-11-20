import { apiBaseUrl, authenticateApiRequest, apiErrorResponse } from "@/lib/server/open-api-auth";
import { invokeStudioTool } from "@/lib/server/open-api-tools";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return Response.json(await invokeStudioTool(await authenticateApiRequest(request), "get_studio_context", {}, apiBaseUrl(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return apiErrorResponse(error); }
}
