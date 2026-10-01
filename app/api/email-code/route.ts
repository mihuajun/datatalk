import { NextResponse } from "next/server";

import { getEmailCodeRetryAfter, isEmailConfigured, sendEmailCode, type EmailCodePurpose } from "@/lib/server/email-auth";
import { getDbPool } from "@/lib/server/mysql";
import type { RowDataPacket } from "mysql2/promise";
import { isRegistrationEnabled } from "@/lib/server/auth-config";

function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function POST(request: Request) {
  if (!isRegistrationEnabled()) return NextResponse.json({ success: false, message: "注册和找回密码功能已关闭。" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { email?: unknown; purpose?: unknown };
  if (!isEmail(body.email)) return NextResponse.json({ success: false, message: "请输入正确的邮箱地址。" }, { status: 400 });
  const email = body.email.trim().toLowerCase();
  const purpose: EmailCodePurpose = body.purpose === "reset-password" ? "reset-password" : "register";

  if (purpose === "reset-password") {
    const [rows] = await getDbPool().query<RowDataPacket[]>(
      "SELECT id FROM tenant_user WHERE LOWER(email) = ? AND status = 1 LIMIT 1",
      [email],
    );
    // Keep account discovery private while allowing registered users to receive a code.
    if (rows.length === 0) return NextResponse.json({ success: true, message: "如果该邮箱已绑定账号，验证码将发送到你的邮箱。" });
  }

  try {
    const result = await sendEmailCode(email, purpose);
    return NextResponse.json({ success: true, ...result, message: "验证码已发送，请查收邮件。" });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_RATE_LIMITED") {
      const retryAfter = typeof (error as Error & { retryAfter?: unknown }).retryAfter === "number"
        ? (error as Error & { retryAfter: number }).retryAfter
        : getEmailCodeRetryAfter(email, purpose);
      return NextResponse.json({ success: false, message: `请 ${retryAfter} 秒后再试。`, retryAfter }, { status: 429 });
    }
    if (error instanceof Error && error.message === "EMAIL_NOT_CONFIGURED") {
      return NextResponse.json({ success: false, message: "邮箱服务尚未配置，请联系管理员。" }, { status: 503 });
    }
    console.error("Send email code failed", { configured: isEmailConfigured(), error });
    return NextResponse.json({ success: false, message: "验证码发送失败，请稍后重试。" }, { status: 502 });
  }
}
