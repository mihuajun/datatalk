import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { listMyFavorites } from "@/lib/server/favorite-repository";
import { getWebAppUrl } from "@/lib/server/site-config";

function withCors(response: NextResponse, request: Request) {
  const allowedOrigin = getWebAppUrl();
  const origin = request.headers.get("origin");
  if (allowedOrigin && origin === allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Vary", "Origin");
  }
  return response;
}

export async function OPTIONS(request: Request) {
  return withCors(new NextResponse(null, { status: 204, headers: { "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Accept, Content-Type" } }), request);
}

export async function GET(request: Request) {
  const session = await getAuthSession();
  if (!session) return withCors(NextResponse.json({ message: "未登录" }, { status: 401 }), request);
  return withCors(NextResponse.json({ favorites: await listMyFavorites(session.userId) }), request);
}
