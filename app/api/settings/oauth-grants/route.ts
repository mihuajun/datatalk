import { getAuthSession } from "@/lib/server/auth-session";
import { apiErrorResponse, OpenApiError } from "@/lib/server/open-api-auth";
import { listOAuthGrants } from "@/lib/server/studio-oauth";
export async function GET() { try { const session=await getAuthSession(); if (!session) throw new OpenApiError("UNAUTHENTICATED",401,"请先登录"); return Response.json({grants:await listOAuthGrants(session)}, {headers:{"Cache-Control":"no-store"}}); } catch(e) { return apiErrorResponse(e); } }
