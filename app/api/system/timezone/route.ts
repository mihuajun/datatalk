import { NextResponse } from "next/server";

import { getSystemTimeZone } from "@/lib/server/system-settings";

// 时区不是敏感信息，供各页面格式化时间使用
export async function GET() {
  return NextResponse.json({ timeZone: getSystemTimeZone() });
}
