import { apiBaseUrl, authenticateApiRequest, apiErrorResponse, readApiJson } from "@/lib/server/open-api-auth";
import { invokeStudioTool } from "@/lib/server/open-api-tools";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  try {
    const principal = await authenticateApiRequest(request);
    return Response.json(await invokeStudioTool(principal, (await params).tool, await readApiJson(request), apiBaseUrl(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
