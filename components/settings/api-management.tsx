"use client";
import { OAuthConnections } from "@/components/settings/oauth-connections";
import { WorkBuddyBinding } from "@/components/settings/workbuddy-binding";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { type ApiKeyView } from "@/lib/open-api-contract";

const inputClass = "mt-2 h-10 w-full rounded-md border border-[#DDE5F0] bg-white px-3 text-sm outline-none focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10";
function date(value: string | null) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "尚未使用"; }
async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "操作失败，请重试");
  return result;
}
export function ApiManagement() {
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [mcpUrl, setMcpUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ApiKeyView | null>(null);
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState("");
  const [copyingId, setCopyingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "我的应用" });
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const keyResult = await jsonRequest("/api/settings/api-keys");
      setKeys(keyResult.keys);
    } catch (error) { setError(error instanceof Error ? error.message : "加载失败，请重试"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { setMcpUrl(`${window.location.origin}/api/mcp`); void refresh(); }, [refresh]);
  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === "Escape" && !busy) { setCreating(false); setPendingDelete(null); setSecret(""); } }
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [busy]);
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); }
    catch { setError("复制失败，请手动复制输入框内容"); }
  }
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(""), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copyApiKey(key: ApiKeyView) {
    setCopyingId(key.id); setError("");
    try {
      const result = await jsonRequest(`/api/settings/api-keys/${key.id}/secret`, { method: "POST" });
      await navigator.clipboard.writeText(result.secret);
      setCopied(`key-${key.id}`);
    } catch (error) { setError(error instanceof Error ? error.message : "复制失败，请重试"); }
    finally { setCopyingId(null); }
  }
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await jsonRequest("/api/settings/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setSecret(result.secret); setCreating(false); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "创建失败"); }
    finally { setBusy(false); }
  }
  async function confirmDelete() {
    if (!pendingDelete) return; setBusy(true); setError("");
    try { await jsonRequest(`/api/settings/api-keys/${pendingDelete.id}`, { method: "DELETE" }); setPendingDelete(null); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(false); }
  }
  return <div className="settings-page">
    <main className="min-w-0 w-full">
      <div className="settings-content-topline"><div><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A97AA]">外部应用连接</div><h1 className="mt-2 text-2xl font-bold tracking-tight">API 管理</h1><p className="mt-1.5 text-[13px] text-[#71819B]">让外部应用访问你的数据与报表。每个 API Key 归属于当前账号和租户。</p></div><button className="settings-refresh-button" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />刷新</button></div>
      {error && <p role="alert" className="mb-4 rounded-md border border-[#FFD4DC] bg-[#FFF6F7] p-3 text-sm text-[#C73A55]">{error}</p>}
      <section className="rounded-xl border border-[#DDE5F0] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 text-base font-bold"><ShieldCheck className="h-5 w-5 text-[#2167E8]" />连接到 DataTalk Studio</h2><p className="mt-2 text-sm text-[#71819B]">将以下完整地址配置为 MCP Server 地址，使用 API Key 或 OAuth 账号授权连接。</p></div><span className="rounded-md bg-[#EDF3FF] px-3 py-1.5 text-xs font-medium text-[#2167E8]">MCP · 报表开发</span></div>
        <div className="mt-5"><label className="text-xs font-semibold text-[#526174]">MCP Server 地址<div className="mt-2 flex rounded-md border border-[#DDE5F0] bg-[#F7F9FC]"><input className="h-10 min-w-0 flex-1 bg-transparent px-3 font-mono text-xs outline-none" readOnly value={mcpUrl} aria-label="MCP Server 地址" /><button className="px-3 text-[#526174] hover:text-[#2167E8]" aria-label="复制 MCP Server 地址" onClick={() => void copy(mcpUrl, "mcpUrl")}>{copied === "mcpUrl" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button></div></label></div>
        <p className="mt-4 text-xs leading-5 text-[#71819B]">API Key 用于连接 Studio；数据库账号由 Studio 管理。连接后可创建和修改报表，正式发布与公共分享仍在 Studio 完成。</p>
      </section>
      <section className="mt-5 overflow-hidden rounded-xl border border-[#DDE5F0] bg-white"><div className="flex items-center justify-between border-b border-[#E7EDF5] p-5"><div><h2 className="text-base font-bold">我的 API Key</h2><p className="mt-1 text-xs text-[#71819B]">API Key 脱敏显示，点击右侧图标复制完整值；删除后后续请求立即失效。</p></div><button className="settings-primary-button" onClick={() => { setCreating(true); setError(""); }}><Plus className="h-4 w-4" />创建 API Key</button></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap"><thead className="bg-[#F7F9FC] text-[#71819B]"><tr>{["名称", "API Key", "创建时间", "最近使用", "操作"].map(h => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{keys.map(key => <tr key={key.id} className="border-t border-[#E7EDF5]"><td className="px-5 py-4 font-semibold text-[#17243A]"><div className="max-w-[220px] truncate" title={key.name}>{key.name}</div></td><td className="px-5 py-4"><div className="flex items-center gap-2"><span className="font-mono text-[#71819B]">{key.prefix}…</span><button className="inline-flex h-7 w-7 items-center justify-center rounded text-[#71819B] hover:bg-[#EDF3FF] hover:text-[#2167E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2167E8] disabled:cursor-not-allowed disabled:opacity-40" aria-label={`${copied === `key-${key.id}` ? "已复制" : "复制"} API Key：${key.name}`} title={copied === `key-${key.id}` ? "已复制完整 API Key" : "复制完整 API Key"} disabled={copyingId !== null} onClick={() => void copyApiKey(key)}>{copyingId === key.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : copied === `key-${key.id}` ? <Check className="h-3.5 w-3.5 text-[#238252]" /> : <Copy className="h-3.5 w-3.5" />}</button></div></td><td className="px-5 py-4 text-[#526174]">{date(key.createdAt)}</td><td className="px-5 py-4 text-[#526174]">{date(key.lastUsedAt)}</td><td className="px-5 py-4"><button className="font-semibold text-[#C73A55]" onClick={() => { setPendingDelete(key); setError(""); }}>删除</button></td></tr>)}</tbody></table></div>
        {!keys.length && <div className="px-6 py-10 text-center"><KeyRound className="mx-auto h-7 w-7 text-[#9AA8BA]" /><p className="mt-3 text-sm font-semibold">{loading ? "正在加载 API Key" : "还没有创建 API Key"}</p><p className="mt-2 text-xs text-[#71819B]">为你的应用创建一个 API Key，连接 DataTalk Studio 分析数据和开发报表。</p></div>}
      </section>
      <OAuthConnections />
      <WorkBuddyBinding />
    </main>
    {(creating || secret || pendingDelete) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17243A]/30 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={secret ? "保存 API Key" : pendingDelete ? "删除 API Key" : "创建 API Key"}><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">{secret ? "API Key 已创建" : pendingDelete ? "删除 API Key" : "创建 API Key"}</h2><button aria-label="关闭" className="rounded p-2 hover:bg-[#F2F4F7]" disabled={busy} onClick={() => { setCreating(false); setSecret(""); setPendingDelete(null); }}><X className="h-4 w-4" /></button></div>
      {error && <p role="alert" className="mt-3 text-sm text-[#C73A55]">{error}</p>}
      {secret ? <div><p className="mt-4 text-sm leading-6 text-[#526174]">你可以在列表中随时复制完整 API Key。复制到接入应用的 API Key 输入框，然后关闭此窗口。</p><textarea aria-label="新创建的 API Key" readOnly value={secret} className="mt-4 w-full resize-none rounded-md border border-[#DDE5F0] bg-[#F7F9FC] p-3 font-mono text-sm" /><button className="settings-primary-button mt-4" onClick={() => void copy(secret, "secret")}>{copied === "secret" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}复制 API Key</button><button className="settings-secondary-button ml-3" onClick={() => setSecret("")}>我已保存</button></div> : pendingDelete ? <div><p className="my-5 text-sm leading-6 text-[#526174]">确定删除“{pendingDelete.name}”吗？此操作将永久删除这条 API Key，无法恢复。使用此 API Key 的应用将无法继续访问 Studio，历史调用记录会保留。</p><div className="flex justify-end gap-3"><button className="settings-secondary-button" onClick={() => setPendingDelete(null)} disabled={busy}>取消</button><button className="rounded-md bg-[#C73A55] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void confirmDelete()} disabled={busy}>{busy ? "删除中" : "确认删除"}</button></div></div> : <form onSubmit={create} className="mt-5 space-y-4"><label className="block text-sm font-medium">名称<input autoFocus required maxLength={100} className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><p className="text-xs leading-5 text-[#71819B]">创建后即可连接 Studio，API Key 一直有效，直到你主动删除。</p><div className="flex justify-end gap-3 border-t border-[#E7EDF5] pt-5"><button type="button" className="settings-secondary-button" onClick={() => setCreating(false)} disabled={busy}>取消</button><button className="settings-primary-button" disabled={busy}>{busy ? "创建中" : "创建 API Key"}</button></div></form>}
    </div></div>}
  </div>;
}
