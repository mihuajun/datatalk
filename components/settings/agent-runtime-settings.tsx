"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  Download,
  Play,
  Power,
  RefreshCw,
  Settings2,
  XCircle,
} from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";

type AgentRuntimeState = "not_installed" | "installing" | "installed" | "running";
type AgentRuntimeAction = "install" | "start" | "restart" | "stop";

type AgentModelConfig = {
  baseUrl: string;
  model: string;
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
  { key: "more", label: "更多配置项", icon: Settings2, active: false },
];

export function AgentRuntimeSettings() {
  const [runtime, setRuntime] = useState<AgentRuntimeStatus | null>(null);
  const [model, setModel] = useState<AgentModelConfig | null>(null);
  const [modelForm, setModelForm] = useState({ baseUrl: "", apiKey: "", model: "" });
  const [modelLoading, setModelLoading] = useState(true);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelExpanded, setModelExpanded] = useState(false);
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
      if (nextModel) setModelForm({ baseUrl: nextModel.baseUrl, apiKey: "", model: nextModel.model });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取模型配置失败");
    } finally {
      setModelLoading(false);
    }
  }

  async function saveModelConfig() {
    setModelSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/settings/agent-model", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(modelForm) });
      const result = await response.json() as { message?: string; model?: AgentModelConfig };
      if (!response.ok || !result.model) throw new Error(result.message || "保存模型配置失败");
      setModel(result.model);
      setModelForm((current) => ({ ...current, apiKey: "" }));
      setModelExpanded(false);
      setMessage(result.message || "模型配置已保存");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存模型配置失败");
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
            {navItems.map(({ key, label, icon: Icon, active }) => (
              <div key={key} className={`settings-nav-item ${active ? "settings-nav-item-active" : ""}`}>
                <Icon className="h-[17px] w-[17px] shrink-0" />
                <span className="text-[13px] font-semibold">{label}</span>
              </div>
            ))}

          </nav>
        </aside>

        <main className="settings-content">
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
                  <p className="mt-1.5 text-[13px] leading-6 text-[#71819B]">使用 <code className="rounded bg-[#f1f4f8] px-1.5 py-0.5 text-[12px] text-[#526174]">@deepseek-ai/dsh@latest</code>，由当前系统统一管理。</p>
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

          {runtime?.installed ? (
            <section id="agent-model-config" className="settings-model-card">
              <div className="settings-model-heading">
                <div className="flex items-center gap-3">
                  <div className="settings-model-mark"><BrainCircuit className="h-5 w-5" /></div>
                  <div>
                    <div className="flex items-center gap-2.5"><h2 className="text-[17px] font-bold text-[#17243A]">模型配置</h2>{model?.apiKeyConfigured ? <StatusBadge tone="success">已配置</StatusBadge> : <StatusBadge tone="warning">未配置</StatusBadge>}</div>
                    <p className="mt-1 text-[13px] text-[#71819B]">为 Agent Runtime 配置可用模型</p>
                  </div>
                </div>
                <button type="button" onClick={() => setModelExpanded((current) => !current)} className="settings-secondary-button">{modelExpanded ? "收起" : "配置"}</button>
              </div>
              {modelExpanded ? (
                <div className="settings-model-form">
                  <label className="settings-model-field settings-model-field-wide"><span>Base URL</span><input value={modelForm.baseUrl} onChange={(event) => updateModelField("baseUrl", event.target.value)} placeholder="https://api.example.com/v1" /></label>
                  <label className="settings-model-field"><span>模型名称</span><input value={modelForm.model} onChange={(event) => updateModelField("model", event.target.value)} placeholder="deepseek-chat" /></label>
                  <label className="settings-model-field"><span>API Key {model?.apiKeyPreview ? <em>当前 {model.apiKeyPreview}</em> : null}</span><input type="password" value={modelForm.apiKey} onChange={(event) => updateModelField("apiKey", event.target.value)} placeholder={model?.apiKeyConfigured ? "留空则保留当前 Key" : "请输入 API Key"} /></label>
                  <div className="settings-model-actions"><button type="button" onClick={() => void saveModelConfig()} disabled={modelLoading || modelSaving} className="settings-primary-button">{modelSaving ? "校验并保存…" : "校验并保存"}</button><span>保存前会请求模型接口进行校验</span></div>
                </div>
              ) : null}
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
