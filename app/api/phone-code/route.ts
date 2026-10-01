import { NextResponse } from "next/server";

import { getCodeRetryAfter, isSmsConfigured, sendPhoneCode, type PhoneCodePurpose } from "@/lib/server/sms-auth";
import { isRegistrationEnabled } from "@/lib/server/auth-config";
import { getDbPool } from "@/lib/server/mysql";
import type { RowDataPacket } from "mysql2/promise";

function isPhone(value: unknown): value is string {
  return typeof value === "string" && /^1\d{10}$/.test(value.trim());
}

export async function POST(request: Request) {
  if (!isRegistrationEnabled()) return NextResponse.json({ success: false, message: "非账号密码登录功能已关闭。" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { phone?: unknown; purpose?: unknown };
  if (!isPhone(body.phone)) return NextResponse.json({ success: false, message: "请输入正确的手机号。" }, { status: 400 });
  const purpose: PhoneCodePurpose = body.purpose === "reset-password" ? "reset-password" : "register";
  const phone = body.phone.trim();

  if (purpose === "reset-password") {
    const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT id FROM tenant_user WHERE phone = ? AND status = 1 LIMIT 1", [phone]);
    if (rows.length === 0) return NextResponse.json({ success: true, message: "如果该手机号已绑定账号，验证码将发送到你的手机。" });
  }

  try {
    const result = await sendPhoneCode(phone, purpose);
    return NextResponse.json({
      success: true,
      ...result,
      message: isSmsConfigured() ? "验证码已发送，请注意查收短信。" : "验证码已生成（当前为本地开发模式）。",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SMS_RATE_LIMITED") {
      const retryAfter = typeof (error as Error & { retryAfter?: unknown }).retryAfter === "number"
        ? (error as Error & { retryAfter: number }).retryAfter
        : getCodeRetryAfter(phone, purpose);
      return NextResponse.json({ success: false, message: `请 ${retryAfter} 秒后再试。`, retryAfter }, { status: 429 });
    }
    if (error instanceof Error && error.message === "SMS_NOT_CONFIGURED") {
      return NextResponse.json({ success: false, message: "短信服务尚未配置，请联系管理员。" }, { status: 503 });
    }
    console.error("Send phone code failed", error);
    return NextResponse.json({ success: false, message: "验证码发送失败，请稍后重试。" }, { status: 502 });
  }
}
