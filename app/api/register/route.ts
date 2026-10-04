import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { authCookieOptions, encodeAuthSession } from "@/lib/server/auth-session";
import { registerAccount } from "@/lib/server/account-registration";
import { consumeEmailCode } from "@/lib/server/email-auth";
import { consumePhoneCode } from "@/lib/server/sms-auth";
import { safeReturnTo } from "@/lib/server/safe-return-to";
import { isRegistrationEnabled } from "@/lib/server/auth-config";

function isPhone(value: string) { return /^1\d{10}$/.test(value); }
function isEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

export async function POST(request: Request) {
  if (!isRegistrationEnabled()) return NextResponse.json({ success: false, message: "注册功能已关闭，请使用账号密码登录。" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const method = body.method === "email" ? "email" : "phone";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  const contact = typeof body.contact === "string" ? body.contact.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,30}$/.test(username)) return NextResponse.json({ success: false, message: "用户名需为 2-30 位中文、字母、数字、下划线或短横线。" }, { status: 400 });
  if (password.length < 6 || password.length > 72) return NextResponse.json({ success: false, message: "密码需为 6-72 位。" }, { status: 400 });
  if (password !== confirmPassword) return NextResponse.json({ success: false, message: "两次输入的密码不一致。" }, { status: 400 });
  if (method === "phone" && !isPhone(contact)) return NextResponse.json({ success: false, message: "请输入正确的手机号。" }, { status: 400 });
  if (method === "email" && !isEmail(contact)) return NextResponse.json({ success: false, message: "请输入正确的邮箱地址。" }, { status: 400 });
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ success: false, message: "请输入 6 位验证码。" }, { status: 400 });

  const verified = method === "phone" ? consumePhoneCode(contact, code) : consumeEmailCode(contact, code);
  if (!verified) return NextResponse.json({ success: false, message: "验证码不正确或已过期。" }, { status: 401 });

  try {
    const user = await registerAccount({ username, password, ...(method === "phone" ? { phone: contact } : { email: contact }) });
    const response = NextResponse.json({ success: true, redirectTo: safeReturnTo(body.returnTo) });
    response.cookies.set(AUTH_COOKIE_NAME, encodeAuthSession(user), authCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "USERNAME_EXISTS") return NextResponse.json({ success: false, message: "用户名已被使用。" }, { status: 409 });
      if (error.message === "PHONE_EXISTS") return NextResponse.json({ success: false, message: "该手机号已注册，请直接登录。" }, { status: 409 });
      if (error.message === "EMAIL_EXISTS") return NextResponse.json({ success: false, message: "该邮箱已注册，请直接登录。" }, { status: 409 });
    }
    console.error("Register account failed", error);
    return NextResponse.json({ success: false, message: "注册服务暂时不可用，请稍后重试。" }, { status: 500 });
  }
}
