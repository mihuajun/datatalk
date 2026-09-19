import { NextResponse } from "next/server";

import { canAccessMembersSession, getAuthSession } from "@/lib/server/auth-session";
import { createMember, listMembers, type MemberRole } from "@/lib/server/member-repository";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function role(value: unknown): MemberRole | null {
  return value === "admin" || value === "developer" ? value : null;
}

export async function GET() {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  if (!canAccessMembersSession(session)) return NextResponse.json({ message: "无权限" }, { status: 403 });

  try {
    return NextResponse.json({ members: await listMembers(session.tenantId) });
  } catch (error) {
    console.error("List members failed", error);
    return NextResponse.json({ message: "用户数据暂时不可用" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  if (!canAccessMembersSession(session)) return NextResponse.json({ message: "无权限" }, { status: 403 });

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = text(body.name);
    const username = text(body.username);
    const email = text(body.email);
    const password = text(body.password);
    const memberRole = role(body.role);
    if (!name || !username || !password || !memberRole) return NextResponse.json({ message: "请完整填写用户信息" }, { status: 400 });
    const member = await createMember({ tenantId: session.tenantId, name, username, email, password, role: memberRole });
    return NextResponse.json({ member }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error && "code" in error && error.code === "ER_DUP_ENTRY" ? "用户名已存在" : "新增用户失败";
    console.error("Create member failed", error);
    return NextResponse.json({ message }, { status: 400 });
  }
}
