import { NextResponse } from "next/server";

import { getAuthSession, isAdministratorSession } from "@/lib/server/auth-session";
import {
  detectSystemTimeZone,
  getSystemSettings,
  getTimeZoneOffsetHours,
  saveSystemSettings,
} from "@/lib/server/system-settings";

function buildPreview(timezone: string) {
  const effective = timezone || detectSystemTimeZone();
  const now = new Date();
  const offsetHours = getTimeZoneOffsetHours(effective, now);
  const sign = offsetHours >= 0 ? "+" : "-";
  const offsetLabel = `UTC${sign}${Math.abs(offsetHours)}`;
  const currentTime = new Intl.DateTimeFormat("zh-CN", {
    timeZone: effective,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  return { effectiveTimeZone: effective, offsetLabel, currentTime };
}

export async function GET() {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  if (!isAdministratorSession(session)) return NextResponse.json({ message: "无权限" }, { status: 403 });

  try {
    const settings = getSystemSettings();
    return NextResponse.json({ settings, systemTimeZone: detectSystemTimeZone(), preview: buildPreview(settings.timezone) });
  } catch (error) {
    console.error("Get system settings failed", error);
    return NextResponse.json({ message: "读取系统设置失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });
  if (!isAdministratorSession(session)) return NextResponse.json({ message: "无权限" }, { status: 403 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
    const settings = saveSystemSettings({ timezone });
    return NextResponse.json({ message: "系统设置已保存并立即生效", settings, systemTimeZone: detectSystemTimeZone(), preview: buildPreview(settings.timezone) });
  } catch (error) {
    console.error("Save system settings failed", error);
    const message = error instanceof Error && error.message.trim() ? error.message : "保存系统设置失败";
    return NextResponse.json({ message }, { status: 400 });
  }
}
