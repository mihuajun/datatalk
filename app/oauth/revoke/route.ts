import { revokeOAuthToken, readOAuthBody, oauthErrorResponse } from "@/lib/server/studio-oauth";
export async function POST(request: Request) { try { await revokeOAuthToken(await readOAuthBody(request)); return new Response(null, { status:200, headers:{"Cache-Control":"no-store"} }); } catch(e) { return oauthErrorResponse(e); } }
