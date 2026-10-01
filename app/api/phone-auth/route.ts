import { NextResponse } from "next/server";

import { encodeAuthSession } from "@/lib/server/auth-session";
import { findOrCreatePhoneUser } from "@/lib/server/phone-auth-repository";
import { consumePhoneCode, isSmsConfigured } from "@/lib/server/sms-auth";
import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { safeReturnTo } from "@/lib/server/safe-return-to";
import { isRegistrationEnabled } from "@/lib/server/auth-config";

function isPhone(value: unknown): value is string {
  return typeof value === "string" && /^1\d{10}$/.test(value.trim());
}

export async function POST(request: Request) {
  if (!isRegistrationEnabled()) return NextResponse.json({ success: false, message: "非账号密码登录功能已关闭。" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { phone?: unknown; code?: unknown; returnTo?: unknown };
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!isPhone(phone)) return NextResponse.json({ success: false, message: "请输入正确的手机号。" }, { status: 400 });
  if (!consumePhoneCode(phone, code)) {
    const message = isSmsConfigured() ? "验证码不正确或已过期。" : "验证码不正确，请重新获取验证码。";
    return NextResponse.json({ success: false, message }, { status: 401 });
  }

  try {
    const user = await findOrCreatePhoneUser(phone);
    const response = NextResponse.json({
      success: true,
      created: user.created,
      redirectTo: safeReturnTo(body.returnTo),
    });
    response.cookies.set(AUTH_COOKIE_NAME, encodeAuthSession(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
      ...(process.env.AUTH_COOKIE_DOMAIN?.trim() ? { domain: process.env.AUTH_COOKIE_DOMAIN.trim() } : {}),
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "PHONE_USER_DISABLED") {
      return NextResponse.json({ success: false, message: "该手机号对应的工作台已被停用。" }, { status: 403 });
    }
    console.error("Phone authentication failed", error);
    return NextResponse.json({ success: false, message: "注册服务暂时不可用，请稍后重试。" }, { status: 500 });
  }
}
