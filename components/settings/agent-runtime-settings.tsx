"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  Download,
  ExternalLink,
  Play,
  Power,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { MetricEmbeddingSettings } from "./metric-embedding-settings";
import { StatusBadge } from "@/components/shared/status-badge";

type AgentRuntimeState = "not_installed" | "installing" | "installed" | "running";
type AgentRuntimeAction = "install" | "start" | "restart" | "stop";

type AgentModelConfig = {
  baseUrl: string;
  model: string;
  imageModel: string;
  imageEnabled: boolean;
  imageBaseUrl: string;
  imageApiKeyConfigured: boolean;
  imageApiKeyPreview: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
};

type AgentRuntimeStatus = {
  state: AgentRuntimeState;
  installed: boolean;
  installing: boolean;
  installStartedAt: string | null;
  installFinishedAt: string | null;
  installElapsedMs: number | null;
  installError: string | null;
  running: boolean;
  packageName: string;
  requestedVersion: string;
  installedVersion: string | null;
  installDir: string;
  homeDir: string;
  logPath: string;
  installLogPath: string;
  port: number;
  url: string;
  pid: number | null;
  startedAt: string | null;
  lastAction: AgentRuntimeAction | null;
  lastActionAt: string | null;
  logTail: string[];
  installLogTail: string[];
};

function formatDateTime(value: string | null) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusTone(state: AgentRuntimeState) {
  if (state === "running") return "success";
  if (state === "installed") return "brand";
  return "warning";
}

function statusLabel(state: AgentRuntimeState) {
  if (state === "running") return "运行中";
  if (state === "installing") return "安装中";
  if (state === "installed") return "已安装";
  return "未安装";
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return "暂无";
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

const navItems = [
  { key: "agent-runtime", label: "Agent Runtime", icon: Bot, active: true },
  { key: "agent-model", label: "模型配置", icon: BrainCircuit, active: false },
];

export function AgentRuntimeSettings({ initialRuntimeWebUrl }: { initialRuntimeWebUrl: string | null }) {
  const [tab, setTab] = useState("agent-runtime");
  const [runtime, setRuntime] = useState<AgentRuntimeStatus | null>(null);
  const runtimeWebUrl = initialRuntimeWebUrl;
  const [model, setModel] = useState<AgentModelConfig | null>(null);
  const [modelForm, setModelForm] = useState({ baseUrl: "", apiKey: "", model: "", imageEnabled: false, imageModel: "", imageBaseUrl: "", imageApiKey: "" });
  const [modelLoading, setModelLoading] = useState(true);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelFeedback, setModelFeedback] = useState<{ chat?: { message?: string; error?: string }; image?: { message?: string; error?: string } }>({});
  const imageConfigured = Boolean(model?.imageModel && model.imageBaseUrl && (model.imageApiKeyConfigured || (model.imageBaseUrl === model.baseUrl && model.apiKeyConfigured)));
  const chatDirty = modelForm.baseUrl !== (model?.baseUrl || "") || modelForm.model !== (model?.model || "") || Boolean(modelForm.apiKey);
  const imageDirty = modelForm.imageEnabled !== Boolean(model?.imageEnabled) || modelForm.imageModel !== (model?.imageModel || "") || modelForm.imageBaseUrl !== (model?.imageBaseUrl || model?.baseUrl || "") || Boolean(modelForm.imageApiKey);
  function modelNotice(section: "chat" | "image") {
    const notice = modelFeedback[section];
    return <>{notice?.message ? <p role="status" className="px-6 pb-5 text-sm text-emerald-700">{notice.message}</p> : null}{notice?.error ? <p role="alert" className="px-6 pb-5 text-sm text-red-600">{notice.error}</p> : null}</>;
  }
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<AgentRuntimeAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setClock] = useState(0);

  async function loadModelConfig() {
    setModelLoading(true);
    try {
      const response = await fetch("/api/settings/agent-model", { cache: "no-store" });
      const result = await response.json() as { message?: string; model?: AgentModelConfig | null };
      if (!response.ok) throw new Error(result.message || "读取模型配置失败");
      const nextModel = result.model || null;
      setModel(nextModel);
      if (nextModel) setModelForm({ baseUrl: nextModel.baseUrl, apiKey: "", model: nextModel.model, imageEnabled: Boolean(nextModel.imageEnabled), imageModel: nextModel.imageModel || "", imageBaseUrl: nextModel.imageBaseUrl || nextModel.baseUrl, imageApiKey: "" });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取模型配置失败");
    } finally {
      setModelLoading(false);
    }
  }

  async function saveModelConfig(section: "chat" | "image", action: "test" | "save") {
    if (action === "save" && !(section === "chat" ? chatDirty : imageDirty)) return;
    setModelSaving(true);
    setModelFeedback(current => ({ ...current, [section]: {} }));
    try {
      const response = await fetch("/api/settings/agent-model", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ section, action, ...(section === "chat" ? { baseUrl: modelForm.baseUrl, model: modelForm.model, apiKey: modelForm.apiKey } : { imageEnabled: modelForm.imageEnabled, imageBaseUrl: modelForm.imageBaseUrl, imageModel: modelForm.imageModel, imageApiKey: modelForm.imageApiKey }) }) });
      const result = await response.json() as { message?: string; model?: AgentModelConfig };
      if (!response.ok) throw new Error(result.message || "保存模型配置失败");
      if (action === "save" && result.model) {
        const saved = result.model;
        setModel(saved);
        setModelForm(current => section === "chat" ? { ...current, apiKey: "", baseUrl: saved.baseUrl, model: saved.model } : { ...current, imageApiKey: "", imageBaseUrl: saved.imageBaseUrl, imageModel: saved.imageModel, imageEnabled: saved.imageEnabled });
      }
      setModelFeedback(current => ({ ...current, [section]: { message: result.message || "模型配置已保存" } }));
    } catch (requestError) {
      setModelFeedback(current => ({ ...current, [section]: { error: requestError instanceof Error ? requestError.message : "操作失败" } }));
    } finally {
      setModelSaving(false);
    }
  }

  async function loadRuntimeStatus(options?: { silent?: boolean }) {
    if (!options?.silent) setLoading(true);
    try {
      const response = await fetch("/api/settings/agent-runtime", { cache: "no-store" });
      const result = await response.json() as { message?: string; runtime?: AgentRuntimeStatus };
      if (!response.ok || !result.runtime) throw new Error(result.message || "读取状态失败");
      setRuntime(result.runtime);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取状态失败");
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  async function handleAction(action: AgentRuntimeAction) {
    setBusyAction(action);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/settings/agent-runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as { message?: string; runtime?: AgentRuntimeStatus };
      if (!response.ok || !result.runtime) throw new Error(result.message || "操作失败");
      setRuntime(result.runtime);
      setMessage(result.message || "操作完成");
      if (action === "start" || action === "restart") {
        window.location.reload();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    void loadRuntimeStatus();
    void loadModelConfig();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock((value) => value + 1);
      if (runtime?.installing) void loadRuntimeStatus({ silent: true });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [runtime?.installing]);

  const facts = useMemo(() => runtime ? [
    ["安装版本", runtime.installedVersion || "尚未安装"],
  ] : [], [runtime]);

  const actionBusyText = busyAction ? {
    install: "正在安装最新版本…",
    start: "正在启动 Runtime…",
    restart: "正在重启 Runtime…",
    stop: "正在关闭 Runtime…",
  }[busyAction] : null;

  function updateModelField(field: keyof typeof modelForm, value: string) {
    setModelForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <aside className="settings-nav">
          <div className="settings-nav-heading">系统设置</div>
          <div className="settings-nav-caption">管理系统运行环境与基础能力</div>
          <nav className="mt-7 space-y-1">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button type="button" onClick={() => setTab(key)} key={key} className={`w-full settings-nav-item ${tab === key ? "settings-nav-item-active" : ""}`}>
                <Icon className="h-[17px] w-[17px] shrink-0" />
                <span className="text-[13px] font-semibold">{label}</span>
              </button>
            ))}

          </nav>
        </aside>

        <main className="settings-content">
          {tab === "agent-model" ? <>
          <div className="settings-content-topline"><div><h1 className="text-[24px] font-bold text-[#17243A]">模型配置</h1><p className="mt-2 text-[13px] text-[#71819B]">配置对话基础能力，按需使用图片生成和语义检索。</p></div></div>
          {error ? <div role="alert" className="settings-alert settings-alert-error">{error}</div> : null}
          {runtime?.installed ? (<>
            <section id="agent-model-config" className="settings-model-card">
              <div className="settings-model-heading">
                <div className="flex items-center gap-3">
                  <div className="settings-model-mark"><BrainCircuit className="h-5 w-5" /></div>
                  <div>
                    <div className="flex items-center gap-2.5"><h2 className="text-[17px] font-bold text-[#17243A]">对话模型</h2><span className="text-xs text-slate-500">基础配置</span>{model?.apiKeyConfigured ? <StatusBadge tone="success">已配置</StatusBadge> : <StatusBadge tone="warning">未配置</StatusBadge>}</div>
                    <p className="mt-1 text-[13px] text-[#71819B]">用于报表对话、SQL 分析、报表开发与指标解释。</p>
                  </div>
                </div>
              </div>
                <fieldset disabled={modelLoading || modelSaving || Boolean(busyAction) || runtime.installing} className="settings-model-form">
                  <label className="settings-model-field settings-model-field-wide"><span>服务地址（OpenAI 兼容）</span><input value={modelForm.baseUrl} onChange={(event) => updateModelField("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" /></label>
                  <label className="settings-model-field"><span>模型名称</span><input value={modelForm.model} onChange={(event) => updateModelField("model", event.target.value)} placeholder="deepseek-chat" /></label>
                  <label className="settings-model-field"><span>API Key {model?.apiKeyPreview ? <em>当前 {model.apiKeyPreview}</em> : null}</span><input type="password" value={modelForm.apiKey} onChange={(event) => updateModelField("apiKey", event.target.value)} placeholder={model?.apiKeyConfigured ? "留空则保留当前 Key" : "请输入 API Key"} /></label>
                  <div className="settings-model-actions"><button type="button" onClick={() => void saveModelConfig("chat", "test")} className="settings-secondary-button">测试连接</button><button type="button" onClick={() => void saveModelConfig("chat", "save")} disabled={!chatDirty || modelLoading || modelSaving} className="settings-primary-button">保存配置</button><span>测试不保存；保存后写入 Runtime，不修改图片配置。</span></div>
                </fieldset>
                {modelNotice("chat")}
            </section>
            <div className="mt-8 mb-4"><h2 className="text-sm font-semibold text-slate-700">可选增强</h2><p className="mt-1 text-xs text-slate-500">不配置以下模型，也可以使用报表对话与开发。</p></div>
            <section id="image-model-config" className="settings-model-card mt-5">

              <div className="settings-model-heading"><div><div className="flex items-center gap-3"><h2 className="text-[17px] font-bold text-[#17243A]">图片模型</h2><span className="text-xs text-slate-500">可选</span><StatusBadge tone={imageConfigured ? "success" : "warning"}>{modelLoading ? "读取中" : imageConfigured ? model?.imageEnabled ? "已启用" : "已配置 · 未启用" : "未配置"}</StatusBadge>{imageDirty && !modelLoading ? <span className="text-xs text-amber-600">未保存</span> : null}</div><p className="mt-1 text-[13px] text-[#71819B]">生成报表封面与插图。不配置时，仍可正常使用报表对话、图表和数据分析。</p></div><button type="button" role="switch" aria-label="启用图片生成" aria-checked={modelForm.imageEnabled} disabled={modelLoading || modelSaving} onClick={() => setModelForm(current => ({ ...current, imageEnabled: !current.imageEnabled }))} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${modelForm.imageEnabled ? "bg-blue-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${modelForm.imageEnabled ? "left-0.5 translate-x-5" : "left-0.5"}`} /></button></div>
              {!modelForm.imageEnabled && imageDirty ? <div className="px-6 pb-5"><button type="button" disabled={!imageDirty || modelLoading || modelSaving} className="settings-primary-button" onClick={() => void saveModelConfig("image", "save")}>保存配置</button><span className="ml-3 text-xs text-slate-500">保存后停用图片生成，保留原配置。</span></div> : null}
              <div hidden={!modelForm.imageEnabled}>
              <fieldset disabled={modelLoading || modelSaving || Boolean(busyAction) || runtime.installing} className="settings-model-form">
                  <label className="settings-model-field settings-model-field-wide"><span>服务地址（OpenAI 兼容）</span><input value={modelForm.imageBaseUrl} onChange={event => updateModelField("imageBaseUrl", event.target.value)} placeholder="https://api.example.com/v1" /></label>
                  <label className="settings-model-field"><span>模型名称 <em>可选</em></span><input value={modelForm.imageModel} onChange={(event) => updateModelField("imageModel", event.target.value)} placeholder="gpt-image-2.5" /></label>
                  <label className="settings-model-field"><span>API Key <em>{model?.imageApiKeyPreview ? `当前 ${model.imageApiKeyPreview}` : "未配置独立密钥"}</em></span><input type="password" autoComplete="new-password" value={modelForm.imageApiKey} onChange={(event) => updateModelField("imageApiKey", event.target.value)} placeholder={model?.imageApiKeyConfigured ? "留空保留独立密钥" : "留空共用对话模型 API Key"} /></label>
                  <div className="settings-model-actions"><button type="button" onClick={() => void saveModelConfig("image", "test")} className="settings-secondary-button">测试连接</button><button type="button" onClick={() => void saveModelConfig("image", "save")} disabled={!imageDirty || modelLoading || modelSaving} className="settings-primary-button">保存配置</button><span>测试将生成 1 张图片，可能产生费用，不保存配置。保存不会生成图片。</span></div>
                </fieldset>
              </div>
                {modelNotice("image")}
            </section>
          </>) : <section className="settings-runtime-card" style={{ padding: 24 }}><p className="text-sm text-slate-600">{loading ? "正在读取 Runtime 状态…" : "请先安装 Agent Runtime，再配置模型。"}</p><button type="button" className="settings-secondary-button mt-4" onClick={() => setTab("agent-runtime")}>前往 Agent Runtime</button></section>}
          <div className="mt-5"><MetricEmbeddingSettings /></div>
          </> : <>
          <div className="settings-content-topline">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a97aa]">运行环境</div>
              <h1 className="mt-2 text-[24px] font-bold tracking-[-0.035em] text-[#17243A]">Agent Runtime</h1>
              <p className="mt-1.5 text-[13px] text-[#71819B]">管理 DeepSeek Harness 的安装与进程状态</p>
            </div>
            <button
              type="button"
              onClick={() => void loadRuntimeStatus()}
              disabled={loading || Boolean(busyAction)}
              className="settings-refresh-button"
              aria-label="刷新状态"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>

          <section className="settings-runtime-card">
            <div className="settings-runtime-intro">
              <div className="flex min-w-0 items-start gap-4">
                <div className={`settings-runtime-mark ${runtime?.running ? "settings-runtime-mark-live" : ""}`}>
                  <Bot className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-[17px] font-bold text-[#17243A]">受管运行时</h2>
                    {runtime ? <StatusBadge tone={statusTone(runtime.state)}>{statusLabel(runtime.state)}</StatusBadge> : null}
                  </div>
                  <p className="mt-1.5 text-[13px] leading-6 text-[#71819B]">使用 <code className="rounded bg-[#f1f4f8] px-1.5 py-0.5 text-[12px] text-[#526174]">@deepseek-ai/dsh@{runtime?.requestedVersion || "固定版本"}</code>，由当前系统统一管理。</p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {runtime?.installing ? <span className="settings-installing-label">安装进行中</span> : null}
                {!runtime?.installed && !runtime?.installing ? (
                  <button type="button" onClick={() => void handleAction("install")} disabled={Boolean(busyAction)} className="settings-primary-button"><Download className="h-4 w-4" />安装最新版本</button>
                ) : null}
                {runtime?.installed && !runtime.running ? (
                  <button type="button" onClick={() => void handleAction("start")} disabled={Boolean(busyAction)} className="settings-primary-button"><Play className="h-4 w-4" />启动</button>
                ) : null}
                {runtime?.running ? (
                  <>
                    {runtimeWebUrl ? <a href={runtimeWebUrl} target="_blank" rel="noopener noreferrer" className="settings-secondary-button"><ExternalLink className="h-4 w-4" />打开 Runtime Web</a> : null}
                    <button type="button" onClick={() => void handleAction("restart")} disabled={Boolean(busyAction)} className="settings-primary-button"><RefreshCw className={`h-4 w-4 ${busyAction === "restart" ? "animate-spin" : ""}`} />重启</button>
                    <button type="button" onClick={() => void handleAction("stop")} disabled={Boolean(busyAction)} className="settings-secondary-button"><Power className="h-4 w-4" />关闭</button>
                  </>
                ) : null}
                {runtime?.installed ? <button type="button" onClick={() => void handleAction("install")} disabled={Boolean(busyAction)} className="settings-secondary-button"><Download className="h-4 w-4" />更新</button> : null}
              </div>
            </div>

            {message ? <div className="settings-alert settings-alert-success"><CheckCircle2 className="h-4 w-4 shrink-0" />{message}</div> : null}
            {error ? <div className="settings-alert settings-alert-error"><XCircle className="h-4 w-4 shrink-0" />{error}</div> : null}
            {actionBusyText ? <div className="settings-alert settings-alert-info">{actionBusyText}</div> : null}
            {runtime?.installing ? <div className="settings-install-progress"><div><span>安装耗时</span><strong>{formatDuration(runtime.installElapsedMs)}</strong></div><div><span>开始时间</span><strong>{formatDateTime(runtime.installStartedAt)}</strong></div><div className="settings-install-progress-bar"><span /></div></div> : null}
            {runtime?.installError ? <div className="settings-alert settings-alert-error"><XCircle className="h-4 w-4 shrink-0" />{runtime.installError}</div> : null}

            <div className="settings-facts">
              <div className="settings-fact settings-fact-status">
                <span className="settings-fact-label">当前状态</span>
                <span className="mt-2 flex items-center gap-2 text-[15px] font-semibold text-[#17243A]">
                  <span className={`h-2 w-2 rounded-full ${runtime?.running ? "bg-[#20a66a]" : runtime?.installed ? "bg-[#2167e8]" : "bg-[#d99022]"}`} />
                  {runtime ? statusLabel(runtime.state) : "读取中"}
                </span>
              </div>
              {facts.map(([label, value]) => <div key={label} className="settings-fact"><span className="settings-fact-label">{label}</span><span className="mt-2 block break-all text-[14px] font-semibold text-[#17243A]">{value}</span></div>)}
            </div>

          </section>

          </>}
        </main>
      </div>
    </div>
  );
}
