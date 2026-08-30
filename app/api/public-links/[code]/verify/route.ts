import { NextResponse } from "next/server";

import { hashPublicLinkPassword, setPublicLinkAccessCookie, verifyPublicLinkPassword } from "@/lib/server/public-link-security";
import { getPublicLinkVerificationData } from "@/lib/server/report-repository";

function parseShortCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9]{8}$/.test(code) ? code : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const shortCode = parseShortCode((await params).code);
  if (!shortCode) return NextResponse.json({ message: "公共链接不正确" }, { status: 400 });

  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password.trim() : "";
  if (!/^\d{4}$/.test(password)) {
    return NextResponse.json({ message: "请输入 4 位数字密码" }, { status: 400 });
  }

  const link = await getPublicLinkVerificationData(shortCode);
  if (!link) return NextResponse.json({ message: "公共链接不存在或已失效" }, { status: 404 });
  if (!link.passwordEnabled || !link.password) {
    return NextResponse.json({ success: true });
  }
  if (!verifyPublicLinkPassword(password, link.password)) {
    return NextResponse.json({ message: "密码不正确" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  setPublicLinkAccessCookie(response, {
    linkId: link.id,
    shortCode: link.shortCode,
    passwordHash: hashPublicLinkPassword(link.password),
    expiresAt: link.expiresAt,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
