import { getAuthSession } from "@/lib/server/auth-session";
import { apiErrorResponse, OpenApiError, assertSameOrigin } from "@/lib/server/open-api-auth";
import { revokeOAuthGrant } from "@/lib/server/studio-oauth";
export async function DELETE(request:Request, {params}:{params:Promise<{id:string}>}) { try { assertSameOrigin(request); const session=await getAuthSession(); if (!session) throw new OpenApiError("UNAUTHENTICATED",401,"请先登录"); await revokeOAuthGrant(session,(await params).id); return Response.json({ok:true}, {headers:{"Cache-Control":"no-store"}}); } catch(e) { return apiErrorResponse(e); } }
