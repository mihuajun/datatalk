import { NextResponse } from "next/server";

import { getAuthSession, isAdminSession } from "@/lib/server/auth-session";
import { setMemberEnabled, updateMember, type MemberRole } from "@/lib/server/member-repository";

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function parseId(value: string) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }
function role(value: unknown): MemberRole | null { return value === "admin" || value === "developer" ? value : null; }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  if (!isAdminSession(session)) return NextResponse.json({ message: "无权限" }, { status: 403 });
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ message: "用户编号不正确" }, { status: 400 });

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.enabled === "boolean") {
      return NextResponse.json({ member: await setMemberEnabled(session.tenantId, id, body.enabled) });
    }
    const name = text(body.name); const username = text(body.username); const email = text(body.email); const memberRole = role(body.role); const password = text(body.password);
    if (!name || !username || !memberRole) return NextResponse.json({ message: "请完整填写用户信息" }, { status: 400 });
    return NextResponse.json({ member: await updateMember({ tenantId: session.tenantId, id, name, username, email, role: memberRole, password: password || undefined }) });
  } catch (error: unknown) {
    const message = error instanceof Error && "code" in error && error.code === "ER_DUP_ENTRY" ? "用户名已存在" : "更新用户失败";
    console.error("Update member failed", error);
    return NextResponse.json({ message }, { status: 400 });
  }
}
