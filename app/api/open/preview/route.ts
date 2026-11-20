import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { assertSameOrigin, apiErrorResponse } from "@/lib/server/open-api-auth";
import { readOAuthBody } from "@/lib/server/studio-oauth";
import { redeemPreviewTicket, previewCookieName, PREVIEW_SESSION_SECONDS } from "@/lib/server/studio-preview";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

// Link scanners and client metadata probes must not consume a one-time ticket.
// The fragment stays in the browser; only the actual preview page redeems it.
export async function GET() {
  const nonce = randomBytes(18).toString("base64");
  return new NextResponse(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>报表预览 · DataTalk Studio</title></head><body style="font-family:system-ui;background:#f4f7fb;color:#17243a;padding:48px"><main style="max-width:480px;margin:10vh auto;background:white;padding:32px;border-radius:16px"><h1 id="title">正在打开报表</h1><p id="message" style="line-height:1.8">正在验证本次报表预览授权…</p><noscript>请启用 JavaScript 后重新获取预览链接。</noscript></main><script nonce="${nonce}">
(async () => {
  const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
  history.replaceState(null, '', location.pathname);
  try {
    if (!ticket) throw new Error();
    const response = await fetch(location.pathname, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) });
    const result = await response.json();
    if (!response.ok || !/^\\/preview\\/[A-Za-z0-9][A-Za-z0-9_-]{0,49}\\?workbuddyTools=1$/.test(result.next || '')) throw new Error();
    location.replace(result.next);
  } catch {
    document.getElementById('title').textContent = '请重新获取预览';
    document.getElementById('message').textContent = '预览链接已过期、已使用或连接授权已取消。请从来源应用重新获取预览，无需另外登录 DataTalk Studio。';
  }
})();
</script></body></html>`, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'` } });
}

export async function HEAD() {
  return new NextResponse(null, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readOAuthBody(request);
    const result = await redeemPreviewTicket(typeof body.ticket === "string" ? body.ticket : "");
    // Mark previews opened through the external MCP/WorkBuddy hand-off so the
    // preview page can render its contextual toolbar. Plain Studio previews
    // (including editor previews) remain unchanged.
    const response = NextResponse.json({ next: `/preview/${result.reportCode}?workbuddyTools=1` }, { headers });
    response.cookies.set(previewCookieName(result.reportCode), result.secret, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https", path: "/", maxAge: PREVIEW_SESSION_SECONDS });
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
