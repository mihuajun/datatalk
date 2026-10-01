import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";

import { consumeEmailCode } from "@/lib/server/email-auth";
import { consumePhoneCode } from "@/lib/server/sms-auth";
import { getDbPool } from "@/lib/server/mysql";
import { createSalt, hashPassword } from "@/lib/server/password";
import { isRegistrationEnabled } from "@/lib/server/auth-config";

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value: string) {
  return /^1\d{10}$/.test(value);
}

type UserRow = RowDataPacket & { id: number; status: number };

export async function POST(request: Request) {
  if (!isRegistrationEnabled()) return NextResponse.json({ success: false, message: "找回密码功能已关闭，请联系管理员。" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const method = body.method === "phone" ? "phone" : "email";
  const rawContact = body.contact ?? (method === "email" ? body.email : undefined);
  const contact = typeof rawContact === "string" ? rawContact.trim() : "";
  const email = contact.toLowerCase();
  const phone = contact;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (method === "email" && !isEmail(email)) return NextResponse.json({ success: false, message: "请输入正确的邮箱地址。" }, { status: 400 });
  if (method === "phone" && !isPhone(phone)) return NextResponse.json({ success: false, message: "请输入正确的手机号。" }, { status: 400 });
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ success: false, message: "请输入 6 位验证码。" }, { status: 400 });
  if (password.length < 6 || password.length > 72) return NextResponse.json({ success: false, message: "密码需为 6-72 位。" }, { status: 400 });
  if (password !== confirmPassword) return NextResponse.json({ success: false, message: "两次输入的密码不一致。" }, { status: 400 });
  const verified = method === "phone"
    ? consumePhoneCode(phone, code, "reset-password")
    : consumeEmailCode(email, code, "reset-password");
  if (!verified) return NextResponse.json({ success: false, message: "验证码不正确或已过期。" }, { status: 401 });

  const [rows] = await getDbPool().query<UserRow[]>(
    method === "phone"
      ? "SELECT id, status FROM tenant_user WHERE phone = ? AND status = 1 LIMIT 1"
      : "SELECT id, status FROM tenant_user WHERE LOWER(email) = ? AND status = 1 LIMIT 1",
    [method === "phone" ? phone : email],
  );
  const user = rows[0];
  if (!user) return NextResponse.json({ success: false, message: "该邮箱未绑定可用账号。" }, { status: 404 });

  const salt = createSalt();
  await getDbPool().execute(
    "UPDATE tenant_user SET password = ?, salt = ? WHERE id = ? AND status = 1",
    [hashPassword(password, salt), salt, user.id],
  );
  return NextResponse.json({ success: true, message: "密码已重置，请使用新密码登录。" });
}
