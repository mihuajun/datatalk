import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/server/auth-session";
import { favoriteResource, getFavoriteState, unfavoriteResource } from "@/lib/server/favorite-repository";
import { getWebAppUrl } from "@/lib/server/site-config";

type Context = { params: Promise<{ code: string }> };

async function sessionOrUnauthorized() {
  const session = await getAuthSession();
  return session ? session : null;
}

function withCors(response: NextResponse, request: Request) {
  const allowedOrigin = getWebAppUrl();
  const origin = request.headers.get("origin");
  if (allowedOrigin && origin === allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Accept, Content-Type");
    response.headers.set("Vary", "Origin");
  }
  return response;
}

export async function OPTIONS(request: Request) {
  return withCors(new NextResponse(null, { status: 204 }), request);
}

export async function GET(request: Request, { params }: Context) {
  const session = await sessionOrUnauthorized();
  if (!session) return withCors(NextResponse.json({ message: "未登录" }, { status: 401 }), request);
  const { code } = await params;
  const state = await getFavoriteState(session.userId, decodeURIComponent(code));
  if (!state) return withCors(NextResponse.json({ message: "资源不存在" }, { status: 404 }), request);
  return withCors(NextResponse.json(state), request);
}

export async function POST(request: Request, { params }: Context) {
  const session = await sessionOrUnauthorized();
  if (!session) return withCors(NextResponse.json({ message: "未登录" }, { status: 401 }), request);
  const result = await favoriteResource(session.userId, decodeURIComponent((await params).code));
  if (!result) return withCors(NextResponse.json({ message: "资源不存在" }, { status: 404 }), request);
  return withCors(NextResponse.json(result), request);
}

export async function DELETE(request: Request, { params }: Context) {
  const session = await sessionOrUnauthorized();
  if (!session) return withCors(NextResponse.json({ message: "未登录" }, { status: 401 }), request);
  const result = await unfavoriteResource(session.userId, decodeURIComponent((await params).code));
  if (!result) return withCors(NextResponse.json({ message: "资源不存在" }, { status: 404 }), request);
  return withCors(NextResponse.json(result), request);
}
