import { registerOAuthClient, readOAuthBody, oauthErrorResponse, studioRequestOrigin } from "@/lib/server/studio-oauth";
export async function POST(request: Request) { try { studioRequestOrigin(request); return Response.json(await registerOAuthClient(await readOAuthBody(request)), { status:201, headers: { "Cache-Control":"no-store" } }); } catch(e) { return oauthErrorResponse(e); } }
