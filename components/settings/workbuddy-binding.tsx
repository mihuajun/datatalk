"use client";

import { useEffect, useState } from "react";
import { Link2, X } from "lucide-react";
import { useRouter } from "next/navigation";

type Status = { configured: boolean; connected: boolean; needsReauth: boolean; nickname: string; scope: string; callbackUrl: string };
const messages: Record<string, string> = {
  connected: "WorkBuddy 账号已绑定。",
  profile_pending: "账号授权已保存，用户资料暂未获取，请点击刷新资料重试。",
  access_denied: "已取消 WorkBuddy 授权。",
  invalid_state: "绑定请求已过期或账号已切换，请重新绑定。",
  unauthenticated: "Studio 登录已过期，请重新登录后绑定。",
  not_configured: "管理员尚未配置 WorkBuddy 应用凭据。",
  identity_conflict: "此 WorkBuddy 身份已有其他账号关联，请使用原登录方式登录后处理绑定。",
  failed: "绑定未完成，请检查应用回调地址与凭据后重新绑定。",
};

async function request(method: string, suffix = "") {
  const response = await fetch(`/api/integrations/workbuddy${suffix}`, { method, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || "WorkBuddy 连接暂时不可用");
  return data;
}

export function WorkBuddyBinding() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  async function refresh() { setStatus(await request("GET")); }
  useEffect(() => {
    void refresh().catch(e => setError(e instanceof Error ? e.message : "读取绑定状态失败"));
    const url = new URL(window.location.href), result = url.searchParams.get("workbuddy");
    if (result) {
      setNotice(messages[result] || messages.failed);
      url.searchParams.delete("workbuddy");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setConfirm(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy]);
  async function act(action: "bind" | "refresh" | "disconnect") {
    setBusy(true); setError(""); setNotice("");
    try {
      if (action === "bind") { const data = await request("POST"); window.location.assign(data.url); return; }
      if (action === "refresh") { await request("POST", "/profile"); setNotice("WorkBuddy 用户资料已更新。"); }
      else { await request("DELETE"); setConfirm(false); setNotice("已解除当前 Studio 账号的 WorkBuddy 绑定。"); }
      await refresh();
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败，请重试"); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  return <section aria-label="绑定 WorkBuddy 账号" className="mt-5 overflow-hidden rounded-xl border border-[#DDE5F0] bg-white">
    <div className="border-b border-[#E7EDF5] p-5">
      <h2 className="flex items-center gap-2 text-base font-bold"><Link2 className="h-5 w-5 text-[#2167E8]" />绑定 WorkBuddy 账号</h2>
    <p className="mt-1 text-xs leading-5 text-[#71819B]">关联后可使用 WorkBuddy 登录此账号，并读取已授权的昵称和头像。</p>
    </div>
    <div className="p-5">
      {notice && <p role="status" className="mb-4 text-sm text-[#526174]">{notice}</p>}
      {error && <p role="alert" className="mb-4 text-sm text-[#C73A55]">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-sm font-semibold">{!status ? "正在读取绑定状态" : status.needsReauth ? "授权已失效，请重新绑定" : status.connected ? status.nickname || "已绑定 WorkBuddy 账号" : "尚未绑定"}</p>
          <p className="mt-1 text-xs text-[#71819B]">绑定仅属于当前 Studio 账号和工作空间。</p></div>
        <div className="flex gap-3">
          {status?.connected && <button className="settings-secondary-button" disabled={busy} onClick={() => void act("refresh")}>刷新资料</button>}
          {(status?.connected || status?.needsReauth) && <button className="settings-secondary-button" disabled={busy} onClick={() => setConfirm(true)}>解除绑定</button>}
          {!status?.connected && <button className="settings-primary-button" disabled={busy || !status?.configured} onClick={() => void act("bind")}>{busy ? "正在连接" : status?.needsReauth ? "重新绑定" : "绑定 WorkBuddy"}</button>}
        </div>
      </div>
      {status && !status.configured && <p className="mt-4 rounded-md bg-[#F7F9FC] p-3 text-xs leading-5 text-[#71819B]">管理员配置 WorkBuddy 应用凭据后即可绑定。</p>}
      {status?.callbackUrl && <details className="mt-4 text-xs text-[#71819B]"><summary className="cursor-pointer">应用回调配置</summary><p className="mt-2 leading-5">在 WorkBuddy 开放平台的 Buddy 应用中填写以下 OAuth 回调地址：</p><code className="mt-1 block break-all rounded-md bg-[#F7F9FC] p-3">{status.callbackUrl}</code></details>}
    </div>
    {confirm && <div role="dialog" aria-modal="true" aria-label="解除 WorkBuddy 绑定" className="fixed inset-0 z-50 flex items-center justify-center bg-[#17243A]/30 p-4 backdrop-blur-[2px]"><div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
      <div className="flex items-center justify-between"><h3 className="text-lg font-bold">解除 WorkBuddy 绑定</h3><button aria-label="关闭" disabled={busy} onClick={() => setConfirm(false)}><X className="h-4 w-4" /></button></div>
      <p className="my-5 text-sm leading-6 text-[#526174]">解除后，将无法使用 WorkBuddy 登录此账号，Studio 也会删除对应凭证。请确保已设置其他登录方式。WorkBuddy 平台侧的应用授权仍需在 WorkBuddy 内取消，已授权访问 Studio 的连接不受影响。</p>
      {error && <p role="alert" className="mb-4 text-sm text-[#C73A55]">{error}</p>}
      <div className="flex justify-end gap-3"><button className="settings-secondary-button" disabled={busy} onClick={() => setConfirm(false)}>保留绑定</button><button className="rounded-md bg-[#C73A55] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void act("disconnect")}>{busy ? "处理中" : "确认解除绑定"}</button></div>
    </div></div>}
  </section>;
}
