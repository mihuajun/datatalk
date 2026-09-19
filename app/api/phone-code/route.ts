import { NextResponse } from "next/server";

import { DEMO_PHONE_CODE } from "@/lib/server/phone-auth-repository";

function isPhone(value: unknown): value is string {
  return typeof value === "string" && /^1\d{10}$/.test(value.trim());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { phone?: unknown };
  if (!isPhone(body.phone)) return NextResponse.json({ success: false, message: "请输入正确的手机号。" }, { status: 400 });

  return NextResponse.json({
    success: true,
    expiresIn: 60,
    message: `验证码已发送，测试验证码为 ${DEMO_PHONE_CODE}。`,
  });
}
