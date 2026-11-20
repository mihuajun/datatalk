"use client";
import { useEffect, useState } from "react";
export function MetricEmbeddingSettings() {
  const [form, setForm] = useState({ enabled: false, baseUrl: "", model: "", apiKey: "" });
  const [saved, setSaved] = useState({ enabled: false, baseUrl: "", model: "" });
  const dirty = form.enabled !== saved.enabled || form.baseUrl !== saved.baseUrl || form.model !== saved.model || Boolean(form.apiKey);
  const [keyPreview, setKeyPreview] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/settings/metric-embedding").then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setForm(previous => ({ ...previous, ...data.config }));
      setConfigured(data.config.apiKeyConfigured); setKeyPreview(data.config.apiKeyPreview || "");
      setSaved({ enabled: data.config.enabled, baseUrl: data.config.baseUrl, model: data.config.model });
    }).catch(e => { setError(e.message); }).finally(() => setBusy(false));
  }, []);
  async function run(action: "save" | "test" | "reindex") {
    if (action === "save" && !dirty) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/settings/metric-embedding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setMessage(data.message);
      if (data.config) { setSaved({ enabled: data.config.enabled, baseUrl: data.config.baseUrl, model: data.config.model }); setConfigured(data.config.apiKeyConfigured); setKeyPreview(data.config.apiKeyPreview || ""); setForm(previous => ({ ...previous, enabled: data.config.enabled, baseUrl: data.config.baseUrl, model: data.config.model, apiKey: "" })); }
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  return <>
    <section id="embedding-model-config" className="settings-model-card">

      <div className="settings-model-heading gap-4"><div><div className="flex items-center gap-3"><h2 className="text-[17px] font-bold text-[#17243A]">向量模型</h2><span className="text-xs text-slate-500">可选</span><span className={`text-xs ${saved.enabled ? "text-emerald-700" : "text-slate-500"}`}>{!saved.baseUrl || !saved.model ? "未配置" : saved.enabled ? "已启用" : "已配置 · 未启用"}</span>{dirty ? <span className="text-xs text-amber-600">未保存</span> : null}</div><p className="mt-1 text-[13px] text-[#71819B]">按语义查找已有指标，提高不同问法的召回能力。未启用时使用关键词检索。</p></div><button type="button" role="switch" aria-label="启用向量检索" aria-checked={form.enabled} disabled={busy} onClick={() => setForm(current => ({ ...current, enabled: !current.enabled }))} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${form.enabled ? "bg-blue-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${form.enabled ? "left-0.5 translate-x-5" : "left-0.5"}`} /></button></div>
      {!form.enabled && dirty ? <div className="metric-settings-note pb-5"><button disabled={busy || !dirty} className="settings-primary-button" onClick={() => void run("save")}>保存配置</button><span className="ml-3 text-xs text-slate-500">保存后仅使用关键词检索，保留原配置。</span></div> : null}
      <div hidden={!form.enabled}>
      <p className="metric-settings-note pt-4 text-xs text-slate-500">默认关闭，仅使用关键词。开启后在检索和指标发布时调用向量服务；服务异常时回退关键词检索并标记降级。</p>
      <fieldset disabled={busy} className="settings-model-form">
        <label className="settings-model-field settings-model-field-wide"><span>服务地址（OpenAI 兼容）</span><input value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" /></label>
        <label className="settings-model-field"><span>模型名称</span><input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="填写服务实际支持的 embedding 模型" /></label>
        <label className="settings-model-field"><span>API Key {keyPreview ? <em>当前 {keyPreview}</em> : <em>可选</em>}</span><input type="password" autoComplete="new-password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder={configured ? "留空保留原密钥" : "无鉴权服务可留空"} /></label>
        <div className="settings-model-actions"><button className="settings-secondary-button" onClick={() => void run("test")}>测试连接</button><button disabled={busy || !dirty} className="settings-primary-button" onClick={() => void run("save")}>保存配置</button><button className="settings-secondary-button" onClick={() => void run("reindex")}>重建当前租户索引</button></div>
      </fieldset>
      <p className="metric-settings-note text-xs text-slate-500">支持填写服务地址前缀或完整接口地址，系统自动识别调用方式。模型名称按服务商提供的调用示例填写。</p>
      <p className="metric-settings-note mt-4 pb-5 text-xs leading-6 text-slate-500">配置作用于当前 Studio 实例，保存后无需重启。测试连接使用表单内容，主动请求服务但不保存；重建索引使用已保存配置，仅处理当前租户已生效的正式指标，候选草稿与已归档指标不参与索引。更换模型后旧索引不参与检索，需重新建立。</p>
      </div>
      {busy && <p role="status" className="metric-settings-note mb-4 text-sm">处理中…</p>}
      {message && <p role="status" className="metric-settings-note mb-4 text-sm text-emerald-700">{message}</p>}
      {error && <p role="alert" className="metric-settings-note mb-4 text-sm text-red-600">{error}</p>}

    </section>
  </>;
}
