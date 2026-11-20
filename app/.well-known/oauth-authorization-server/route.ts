import { oauthMetadata, studioRequestOrigin, oauthErrorResponse } from "@/lib/server/studio-oauth";
export async function GET(request: Request) { try { return Response.json(oauthMetadata(studioRequestOrigin(request)), { headers: { "Cache-Control": "no-store" } }); } catch(e) { return oauthErrorResponse(e); } }
