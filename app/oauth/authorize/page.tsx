import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/shared/brand-mark";
import type { RowDataPacket } from "mysql2/promise";
import { getAuthSession } from "@/lib/server/auth-session";
import { getDbPool } from "@/lib/server/mysql";
import { createConsentRequest, validateAuthorization, studioOrigin, OAuthError } from "@/lib/server/studio-oauth";
export const dynamic = "force-dynamic";
// Same-origin form submissions need an Origin for the consent endpoint's CSRF check.
export const metadata = { title: "授权连接 · DataTalk Studio", referrer: "same-origin", robots: { index: false, follow: false } };
export default async function AuthorizePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const raw=await searchParams; const params=new URLSearchParams();
  for (const [key,value] of Object.entries(raw)) for (const v of Array.isArray(value)?value:value?[value]:[]) params.append(key,v);
  const h=await headers();
  let auth;
  try { auth=await validateAuthorization(params,studioOrigin(`http://${h.get("host") || "invalid"}`)); }
  catch(e) { return <main className="flex min-h-screen items-center justify-center bg-[#F4F7FB] p-6"><div className="max-w-md rounded-xl border bg-white p-8"><h1 className="text-xl font-bold">无法完成连接</h1><p className="mt-4 text-sm text-[#526174]">{e instanceof OAuthError?e.message:"授权服务暂时不可用，请重试"}</p><p className="mt-4 text-sm text-[#71819B]">请返回来源应用，重新发起连接。</p></div></main>; }
  const session=await getAuthSession();
  if (!session) redirect(`/?next=${encodeURIComponent(`/oauth/authorize?${params}`)}`);
  const [tenants] = await getDbPool().query<Array<RowDataPacket & { name: string | null }>>(
    "SELECT name FROM tenant WHERE id = ? LIMIT 1", [session.tenantId],
  );
  const workspaceName = tenants[0]?.name?.trim() || "未命名工作空间";
  const requestId=await createConsentRequest(auth,session);
  return <main className="flex min-h-screen items-center justify-center bg-[#F4F7FB] px-5 py-12"><section className="w-full max-w-lg rounded-2xl border border-[#DDE5F0] bg-white p-8 shadow-sm">
    <div className="flex items-center gap-3 text-[#2167E8]"><BrandMark size={36} className="h-9 w-9 shrink-0"/><span className="font-bold">DataTalk Studio</span></div>
    <h1 className="mt-8 break-words text-2xl font-bold">授权给 {auth.clientName}</h1>
    <p className="mt-3 text-sm leading-6 text-[#526174]">允许该应用访问以下工作空间，用于查询数据和开发报表。</p>
    <div className="my-6 rounded-lg bg-[#F4F7FB] p-4 text-sm"><div className="font-semibold">{session.name}（{session.username}）</div><div className="mt-1 break-words text-[#71819B]">当前工作空间 · {workspaceName}</div></div>
    <ul className="list-disc space-y-3 pl-5 text-sm leading-6 text-[#526174]"><li>查看数据源结构，执行受限的只读查询</li><li>读取、创建与修改当前工作空间的报表</li><li>在接入应用中预览指定报表</li></ul>
    <p className="mt-5 text-xs leading-5 text-[#71819B]">正式发布与公共分享仍由你在工作台完成。你可以随时在「API 管理 → 已授权应用」中取消授权。应用名称由连接客户端提供，请确认来自你刚发起的连接。</p>
    <form method="post" action="/api/oauth/authorize" className="mt-8 flex justify-end gap-3"><input type="hidden" name="request_id" value={requestId}/><button name="decision" value="deny" className="settings-secondary-button">取消</button><button name="decision" value="approve" className="settings-primary-button">授权连接</button></form>
  </section></main>;
}
