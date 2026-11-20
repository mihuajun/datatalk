import { exchangeOAuthToken, readOAuthBody, oauthErrorResponse, studioRequestOrigin } from "@/lib/server/studio-oauth";
export async function POST(request: Request) { try { return Response.json(await exchangeOAuthToken(await readOAuthBody(request), studioRequestOrigin(request)), { headers: { "Cache-Control":"no-store", "Pragma":"no-cache" } }); } catch(e) { return oauthErrorResponse(e); } }
