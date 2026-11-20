import { headers } from "next/headers";
import { ShieldCheck } from "lucide-react";
import { safeReturnTo } from "@/lib/server/safe-return-to";
import { studioOrigin, validateAuthorization } from "@/lib/server/studio-oauth";

export async function authorizationReturnClientName(returnTo?: string) {
  if (!returnTo || returnTo.length > 8192 || safeReturnTo(returnTo) !== returnTo) return null;
  const url = new URL(returnTo, "https://studio.invalid");
  if (url.origin !== "https://studio.invalid" || url.pathname !== "/oauth/authorize" || url.hash) return null;
  try {
    const h = await headers();
    const auth = await validateAuthorization(url.searchParams, studioOrigin(`http://${h.get("host") || "invalid"}`));
    return auth.clientName;
  } catch { return null; }
}

export async function AuthorizationReturnNotice({ returnTo, action = "登录" }: { returnTo?: string; action?: "登录" | "注册" | "重设密码" }) {
  const clientName = await authorizationReturnClientName(returnTo);
  if (!clientName) return null;
  return <aside aria-label="连接授权提示" className="mt-5 flex gap-3 rounded-lg border border-[#D6E5FC] bg-[#F1F7FF] p-3.5">
    <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#2167E8]" />
    <div className="min-w-0 text-xs leading-5">
      <p className="break-words font-semibold text-[#284B7F]">正在连接 {clientName}</p>
      <p className="mt-1 text-[#526174]">{action === "重设密码" ? "重设密码并登录后" : `${action}完成后`}将返回授权页，由你确认工作空间和访问权限。</p>
    </div>
  </aside>;
}
