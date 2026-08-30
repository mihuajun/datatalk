import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { AGENT_RUNTIME_ROOT, ensureWorkspaceStorageLayout } from "@/lib/server/workspace-storage";

const RUNTIME_ROOT = AGENT_RUNTIME_ROOT;
const INSTALL_DIR = path.join(RUNTIME_ROOT, "deepseek-harness");
const HOME_DIR = path.join(RUNTIME_ROOT, "home");
const MANAGED_HOME_SOURCE_DIR = path.join(process.cwd(), "runtime-managed", "agent-runtime-home");
const PROJECT_SKILLS_DIR = path.join(process.cwd(), "skills");
const RUNTIME_SKILLS_DIR = path.join(HOME_DIR, "skills");
const MODEL_CONFIG_PATH = path.join(RUNTIME_ROOT, "model.json");
const RUNTIME_SETTINGS_PATH = path.join(HOME_DIR, "settings.yaml");
const RUNTIME_CREDENTIALS_PATH = path.join(HOME_DIR, ".credentials.yaml");
const RUNTIME_EXCLUDED_SKILLS = new Set(["byted-web-search"]);
const MODEL_API_KEY_ENV = "DSH_MANAGED_MODEL_API_KEY";
const STATE_PATH = path.join(RUNTIME_ROOT, "state.json");
const LOG_PATH = path.join(RUNTIME_ROOT, "dsh-web.log");
const INSTALL_LOG_PATH = path.join(RUNTIME_ROOT, "install.log");
const LOCAL_BIN_PATH = path.join(INSTALL_DIR, "node_modules", ".bin", "dsh");
const INSTALLED_PACKAGE_PATH = path.join(INSTALL_DIR, "node_modules", "@deepseek-ai", "dsh", "package.json");
const DSH_ENTRY_PATH = path.join(INSTALL_DIR, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const DEFAULT_PORT = 3080;
const NETWORK_FAMILY_COMPATIBILITY_OPTION = "--no-network-family-autoselection";
const INSTALL_HEAP_OPTION = "--max-old-space-size=8192";

function runtimeNodeOptions() {
  const current = process.env.NODE_OPTIONS?.trim() || "";
  if (current.split(/\s+/).includes(NETWORK_FAMILY_COMPATIBILITY_OPTION)) return current;
  return [current, NETWORK_FAMILY_COMPATIBILITY_OPTION].filter(Boolean).join(" ");
}

function resolveReportAgentToolsBaseUrl() {
  const explicitBaseUrl = process.env.REPORT_AGENT_TOOLS_BASE_URL?.trim();
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/+$/, "");

  const appPort = process.env.PORT?.trim() || "3000";
  return `http://127.0.0.1:${appPort}`;
}

function runtimeEnvironment(modelConfig: AgentModelConfig | null) {
  const env = { ...process.env };
  // The search credential belongs to the host proxy and must never enter dsh,
  // even though the host process needs it for the proxy request.
  delete env.WEB_SEARCH_API_KEY;

  return {
    ...env,
    NODE_OPTIONS: runtimeNodeOptions(),
    ...(modelConfig ? { [MODEL_API_KEY_ENV]: modelConfig.apiKey } : {}),
    DSH_HOME: HOME_DIR,
    REPORT_AGENT_TOOLS_BASE_URL: resolveReportAgentToolsBaseUrl(),
  };
}

export function getAgentRuntimeUrl() {
  return `http://127.0.0.1:${currentPort(readStateFile())}`;
}

export function getAgentRuntimeExecutionConfig(workingDirectory: string) {
  const modelConfig = readModelConfig();
  prepareManagedAgentRuntimeHome();
  if (modelConfig) writeModelConfig(modelConfig);
  const workspaceDirectory = path.resolve(workingDirectory);
  return {
    command: process.execPath,
    args: [DSH_ENTRY_PATH, "--profile", "headless"],
    cwd: workspaceDirectory,
    env: runtimeEnvironment(modelConfig),
  };
}

export type AgentRuntimeAction = "install" | "start" | "restart" | "stop";
export type AgentRuntimeState = "not_installed" | "installing" | "installed" | "running";

export type AgentModelConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AgentModelConfigView = Omit<AgentModelConfig, "apiKey"> & {
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
};

type AgentRuntimeStateFile = {
  pid?: number | null;
  installPid?: number | null;
  installStartedAt?: string | null;
  installFinishedAt?: string | null;
  installStatus?: "idle" | "running" | "success" | "failed";
  installError?: string | null;
  port?: number;
  startedAt?: string | null;
  lastAction?: AgentRuntimeAction | null;
  lastActionAt?: string | null;
};

export type AgentRuntimeStatus = {
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

function ensureDirectories() {
  ensureWorkspaceStorageLayout();
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.mkdirSync(HOME_DIR, { recursive: true });
}

function ensureInstallWorkspace() {
  ensureDirectories();
  const packageJsonPath = path.join(INSTALL_DIR, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          name: "agent-runtime-managed",
          private: true,
          version: "0.0.0",
        },
        null,
        2,
      ),
    );
  }
}

function syncManagedRuntimeHomeFiles() {
  ensureDirectories();
  if (!fs.existsSync(MANAGED_HOME_SOURCE_DIR)) return;

  for (const entry of fs.readdirSync(MANAGED_HOME_SOURCE_DIR, { withFileTypes: true })) {
    const sourcePath = path.join(MANAGED_HOME_SOURCE_DIR, entry.name);
    const targetPath = path.join(HOME_DIR, entry.name);

    if (entry.isDirectory()) {
      fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
      continue;
    }

    if (entry.isFile()) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function migrateLegacyRuntimeCredentialsFile() {
  if (!fs.existsSync(RUNTIME_CREDENTIALS_PATH)) return;

  try {
    const parsed = parseYaml(fs.readFileSync(RUNTIME_CREDENTIALS_PATH, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

    const refs = (parsed as Record<string, unknown>).refs;
    if (!refs || typeof refs !== "object" || Array.isArray(refs)) return;

    const entries = Object.entries(refs);
    if (!entries.every(([key, value]) => key.trim() && typeof value === "string" && value.length > 0)) return;

    fs.writeFileSync(RUNTIME_CREDENTIALS_PATH, stringifyYaml(Object.fromEntries(entries)), { mode: 0o600 });
    fs.chmodSync(RUNTIME_CREDENTIALS_PATH, 0o600);
  } catch {
    // Leave malformed files in place so credentials-local reports the precise
    // validation error instead of silently discarding user data.
  }
}

export function prepareManagedAgentRuntimeHome() {
  syncManagedRuntimeHomeFiles();
  migrateLegacyRuntimeCredentialsFile();
  syncProjectSkillsToRuntime();
}

function syncProjectSkillsToRuntime() {
  ensureDirectories();
  fs.rmSync(RUNTIME_SKILLS_DIR, { recursive: true, force: true });
  fs.mkdirSync(RUNTIME_SKILLS_DIR, { recursive: true });

  if (!fs.existsSync(PROJECT_SKILLS_DIR)) {
    return;
  }

  for (const entry of fs.readdirSync(PROJECT_SKILLS_DIR, { withFileTypes: true })) {
    if (RUNTIME_EXCLUDED_SKILLS.has(entry.name)) continue;

    const sourcePath = path.join(PROJECT_SKILLS_DIR, entry.name);
    const targetPath = path.join(RUNTIME_SKILLS_DIR, entry.name);

    if (entry.isDirectory()) {
      fs.cpSync(sourcePath, targetPath, { recursive: true });
      continue;
    }

    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function appendLogDivider(filePath: string, title: string) {
  ensureDirectories();
  const timestamp = new Date().toISOString();
  fs.appendFileSync(filePath, `\n[${timestamp}] ${title}\n`);
}

function readModelConfig(): AgentModelConfig | null {
  ensureDirectories();
  if (!fs.existsSync(MODEL_CONFIG_PATH)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(MODEL_CONFIG_PATH, "utf8")) as Partial<AgentModelConfig>;
    if ([parsed.baseUrl, parsed.apiKey, parsed.model].every((value) => typeof value === "string" && value.trim())) {
      return {
        baseUrl: parsed.baseUrl!.trim().replace(/\/+$/, ""),
        apiKey: parsed.apiKey!.trim(),
        model: parsed.model!.trim(),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function writeModelConfig(config: AgentModelConfig) {
  ensureDirectories();
  fs.writeFileSync(MODEL_CONFIG_PATH, JSON.stringify(config, null, 2));
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(RUNTIME_CREDENTIALS_PATH, stringifyYaml({
    [MODEL_API_KEY_ENV]: config.apiKey,
  }), { mode: 0o600 });
  fs.chmodSync(RUNTIME_CREDENTIALS_PATH, 0o600);
  fs.writeFileSync(RUNTIME_SETTINGS_PATH, stringifyYaml({
    "agent-default-model": {
      provider: "managed",
      model: config.model,
    },
    "llm-pi-ai": {
      providers: {
        managed: {
          displayName: "DataTalk",
          apiKeyEnv: MODEL_API_KEY_ENV,
          api: "openai-completions",
          baseURL: config.baseUrl,
          defaultInput: ["text", "image"],
          models: [{ id: config.model }],
        },
      },
    },
  }));
}

function modelConfigView(config: AgentModelConfig | null): AgentModelConfigView | null {
  if (!config) return null;
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyPreview: config.apiKey ? `${config.apiKey.slice(0, 4)}••••${config.apiKey.slice(-4)}` : "",
  };
}

export function getAgentModelConfig() {
  return modelConfigView(readModelConfig());
}

async function verifyAgentModelConfig(baseUrl: string, apiKey: string, model: string) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "请只回复：ok" }], max_tokens: 8, temperature: 0 }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`模型配置校验失败（${response.status}）${detail ? `：${detail}` : ""}`);
  }
}

export async function saveAgentModelConfig(input: Partial<AgentModelConfig>, keepExistingApiKey = true) {
  const existing = readModelConfig();
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim().replace(/\/+$/, "") : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const apiKey = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : keepExistingApiKey && existing?.apiKey ? existing.apiKey : "";

  if (!baseUrl || !model || !apiKey) throw new Error("请填写完整的模型地址、API Key 和模型名称");
  new URL(baseUrl);
  await verifyAgentModelConfig(baseUrl, apiKey, model);
  const nextConfig = { baseUrl, apiKey, model };
  writeModelConfig(nextConfig);
  return modelConfigView(nextConfig);
}

function readStateFile(): AgentRuntimeStateFile {
  ensureDirectories();
  if (!fs.existsSync(STATE_PATH)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as AgentRuntimeStateFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStateFile(nextState: AgentRuntimeStateFile) {
  ensureDirectories();
  fs.writeFileSync(STATE_PATH, JSON.stringify(nextState, null, 2));
}

function readInstalledVersion() {
  if (!fs.existsSync(INSTALLED_PACKAGE_PATH)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(INSTALLED_PACKAGE_PATH, "utf8")) as { version?: string };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

function readTail(filePath: string, maxLines = 14) {
  if (!fs.existsSync(filePath)) {
    return [] as string[];
  }

  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) {
    return [] as string[];
  }

  return content.split(/\r?\n/).slice(-maxLines);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readProcessCommand(pid: number) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    try {
      return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  }
}

function commandLooksManaged(pid: number) {
  const command = readProcessCommand(pid);
  return command.includes("@deepseek-ai/dsh") || command.includes("/.bin/dsh") || command.includes(" deepseek-harness") || command.includes("npm install");
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isManagedProcessRunning(pid: number | null | undefined) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  return isProcessAlive(pid) && commandLooksManaged(pid);
}

function findUntrackedInstallProcess() {
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const command = readProcessCommand(Number(entry));
      if (!command.includes("npm install @deepseek-ai/dsh@latest")) continue;
      return { pid: Number(entry), startedAt: new Date().toISOString() };
    }
  } catch {
    try {
      const output = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
      for (const line of output.split("\n")) {
        const match = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!match) continue;
        const pid = Number(match[1]);
        const command = match[2] || "";
        if (!command.includes("npm install @deepseek-ai/dsh@latest")) continue;
        return { pid, startedAt: new Date().toISOString() };
      }
    } catch {
      return null;
    }
  }
  return null;
}

function findUntrackedRuntimeProcess(port: number) {
  try {
    const output = execFileSync("lsof", ["-nP", "-iTCP:" + String(port), "-sTCP:LISTEN", "-Fpct"], { encoding: "utf8" });
    const lines = output.split("\n");
    let pid = 0;
    let command = "";
    for (const line of lines) {
      if (line.startsWith("p")) {
        pid = Number(line.slice(1));
        command = "";
        continue;
      }
      if (line.startsWith("c")) {
        command = line.slice(1);
        if (pid > 0 && command === "node") {
          const fullCommand = readProcessCommand(pid);
          if (fullCommand.includes("@deepseek-ai/dsh") || fullCommand.includes("/dsh/lib/bin.js web --port")) {
            return { pid, startedAt: new Date().toISOString() };
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function currentPort(state: AgentRuntimeStateFile) {
  return Number.isInteger(state.port) && Number(state.port) > 0 ? Number(state.port) : DEFAULT_PORT;
}

export async function getAgentRuntimeStatus(): Promise<AgentRuntimeStatus> {
  ensureDirectories();
  const installedVersion = readInstalledVersion();
  const installed = Boolean(installedVersion) && fs.existsSync(LOCAL_BIN_PATH);
  let stateFile = readStateFile();
  const untrackedInstall = !isManagedProcessRunning(stateFile.installPid) ? findUntrackedInstallProcess() : null;
  if (untrackedInstall) {
    stateFile = {
      ...stateFile,
      installPid: untrackedInstall.pid,
      installStartedAt: stateFile.installStartedAt ?? untrackedInstall.startedAt,
      installFinishedAt: null,
      installStatus: "running",
      installError: null,
    };
    writeStateFile(stateFile);
  }
  const port = currentPort(stateFile);
  const untrackedRuntime = !isManagedProcessRunning(stateFile.pid) ? findUntrackedRuntimeProcess(port) : null;
  if (untrackedRuntime) {
    stateFile = {
      ...stateFile,
      pid: untrackedRuntime.pid,
      startedAt: stateFile.startedAt ?? untrackedRuntime.startedAt,
    };
    writeStateFile(stateFile);
  }
  const running = isManagedProcessRunning(stateFile.pid);
  const installing = isManagedProcessRunning(stateFile.installPid);
  const installStartedAt = stateFile.installStartedAt ?? null;
  const installFinishedAt = stateFile.installFinishedAt ?? null;
  const installElapsedMs = installStartedAt ? Math.max(0, new Date(installFinishedAt ?? Date.now()).getTime() - new Date(installStartedAt).getTime()) : null;

  if (!installing && stateFile.installStatus === "running" && stateFile.installPid) {
    const success = Boolean(readInstalledVersion()) && fs.existsSync(LOCAL_BIN_PATH);
    const reconciled = {
      ...stateFile,
      installPid: null,
      installFinishedAt: stateFile.installFinishedAt ?? new Date().toISOString(),
      installStatus: success ? "success" as const : "failed" as const,
      installError: success ? null : stateFile.installError ?? "安装进程已结束，但未发现完整的 Agent Runtime 文件",
    };
    writeStateFile(reconciled);
  }

  if (!running && stateFile.pid) {
    writeStateFile({
      ...stateFile,
      pid: null,
      startedAt: null,
    });
  }

  return {
    state: installing ? "installing" : running ? "running" : installed ? "installed" : "not_installed",
    installed,
    installing,
    installStartedAt,
    installFinishedAt,
    installElapsedMs,
    installError: stateFile.installError ?? null,
    running,
    packageName: "@deepseek-ai/dsh",
    requestedVersion: "latest",
    installedVersion,
    installDir: INSTALL_DIR,
    homeDir: HOME_DIR,
    logPath: LOG_PATH,
    installLogPath: INSTALL_LOG_PATH,
    port,
    url: `http://127.0.0.1:${port}`,
    pid: running ? stateFile.pid ?? null : null,
    startedAt: running ? stateFile.startedAt ?? null : null,
    lastAction: stateFile.lastAction ?? null,
    lastActionAt: stateFile.lastActionAt ?? null,
    logTail: readTail(LOG_PATH),
    installLogTail: readTail(INSTALL_LOG_PATH),
  };
}

function launchInstallCommand() {
  ensureInstallWorkspace();
  const current = readStateFile();
  if (isManagedProcessRunning(current.installPid)) {
    return;
  }

  const startedAt = new Date().toISOString();
  appendLogDivider(INSTALL_LOG_PATH, "开始安装 @deepseek-ai/dsh@latest");
  const logFd = fs.openSync(INSTALL_LOG_PATH, "a");
  const child = spawn("npm", [
    "install",
    "@deepseek-ai/dsh@latest",
    "--save-exact",
    "--foreground-scripts",
  ], {
    cwd: INSTALL_DIR,
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS?.trim(), INSTALL_HEAP_OPTION, NETWORK_FAMILY_COMPATIBILITY_OPTION]
        .filter(Boolean)
        .join(" "),
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  fs.closeSync(logFd);

  writeStateFile({
    ...current,
    installPid: child.pid ?? null,
    installStartedAt: startedAt,
    installFinishedAt: null,
    installStatus: "running",
    installError: null,
  });
  child.unref();

  child.once("error", (error) => {
    const latest = readStateFile();
    writeStateFile({ ...latest, installPid: null, installFinishedAt: new Date().toISOString(), installStatus: "failed", installError: error.message });
  });
  child.once("close", (code, signal) => {
    const latest = readStateFile();
    const success = code === 0 && Boolean(readInstalledVersion()) && fs.existsSync(LOCAL_BIN_PATH);
    const exitDetails = `退出码 ${code ?? "unknown"}${signal ? `，信号 ${signal}` : ""}`;
    writeStateFile({
      ...latest,
      installPid: null,
      installFinishedAt: new Date().toISOString(),
      installStatus: success ? "success" : "failed",
      installError: success ? null : `安装失败，${exitDetails}`,
      lastAction: success ? "install" : latest.lastAction ?? null,
      lastActionAt: new Date().toISOString(),
    });
  });
}

function resolveLocalBinPath() {
  if (!fs.existsSync(LOCAL_BIN_PATH)) {
    throw new Error("Agent Runtime 尚未安装完成");
  }

  return LOCAL_BIN_PATH;
}

export async function installAgentRuntime() {
  prepareManagedAgentRuntimeHome();
  const current = readStateFile();
  if (!isManagedProcessRunning(current.installPid)) {
    launchInstallCommand();
  }
  return getAgentRuntimeStatus();
}

export async function startAgentRuntime(lastAction: "start" | "restart" = "start") {
  prepareManagedAgentRuntimeHome();
  const currentStatus = await getAgentRuntimeStatus();
  if (!currentStatus.installed) {
    throw new Error("请先安装 Agent Runtime");
  }
  if (currentStatus.running) {
    return currentStatus;
  }

  const stateFile = readStateFile();
  const port = currentPort(stateFile);
  const binPath = resolveLocalBinPath();
  const modelConfig = readModelConfig();
  syncProjectSkillsToRuntime();
  if (modelConfig) writeModelConfig(modelConfig);
  appendLogDivider(LOG_PATH, `启动 dsh web --port ${port}`);

  const logFd = fs.openSync(LOG_PATH, "a");
  const child = spawn(process.execPath, [DSH_ENTRY_PATH, "web", "--port", String(port)], {
    cwd: INSTALL_DIR,
    env: runtimeEnvironment(modelConfig),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();
  fs.closeSync(logFd);

  writeStateFile({
    ...stateFile,
    pid: child.pid ?? null,
    port,
    startedAt: new Date().toISOString(),
    lastAction,
    lastActionAt: new Date().toISOString(),
  });

  await sleep(1500);
  const nextStatus = await getAgentRuntimeStatus();
  if (!nextStatus.running) {
    throw new Error("Agent Runtime 启动失败，请查看日志");
  }
  return nextStatus;
}

async function terminateManagedProcess(pid: number) {
  if (!isManagedProcessRunning(pid)) {
    return;
  }

  process.kill(pid, "SIGTERM");

  for (let index = 0; index < 20; index += 1) {
    await sleep(250);
    if (!isManagedProcessRunning(pid)) {
      return;
    }
  }

  process.kill(pid, "SIGKILL");

  for (let index = 0; index < 8; index += 1) {
    await sleep(125);
    if (!isManagedProcessRunning(pid)) {
      return;
    }
  }
}

export async function stopAgentRuntime() {
  const current = readStateFile();
  if (current.pid && isManagedProcessRunning(current.pid)) {
    appendLogDivider(LOG_PATH, `停止进程 ${current.pid}`);
    await terminateManagedProcess(current.pid);
  }

  writeStateFile({
    ...current,
    pid: null,
    startedAt: null,
    lastAction: "stop",
    lastActionAt: new Date().toISOString(),
  });

  return getAgentRuntimeStatus();
}

export async function restartAgentRuntime() {
  await stopAgentRuntime();
  return startAgentRuntime("restart");
}
