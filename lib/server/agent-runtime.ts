import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getWebAppUrl } from "@/lib/server/site-config";
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
const RUNTIME_PROXY_PRELOAD_PATH = path.join(process.cwd(), "runtime-managed", "agent-runtime-env-proxy.cjs");
const LOCAL_TOOL_BIN_DIR = path.join(INSTALL_DIR, "node_modules", ".bin");
const LOCAL_BIN_PATH = path.join(LOCAL_TOOL_BIN_DIR, "dsh");
const LOCAL_PNPM_PATH = path.join(LOCAL_TOOL_BIN_DIR, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const INSTALLED_PACKAGE_PATH = path.join(INSTALL_DIR, "node_modules", "@deepseek-ai", "dsh", "package.json");
const DSH_ENTRY_PATH = path.join(INSTALL_DIR, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const DEFAULT_PORT = 3080;
const INSTALL_HEAP_OPTION = "--max-old-space-size=8192";
const DEFAULT_AGENT_RUNTIME_VERSION = "0.1.2-rc.1";
const MANAGED_PNPM_VERSION = "12.3.4";
const MIN_RUNTIME_NODE_MAJOR = 22;
const MIN_RUNTIME_NODE_MINOR = 5;
const VISION_PROBE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const AUTH_BOOTSTRAP_RETRIES = 20;
const AUTH_BOOTSTRAP_RETRY_DELAY_MS = 100;

function getAgentRuntimePackageVersion() {
  const configured = process.env.AGENT_RUNTIME_PACKAGE_VERSION?.trim();
  return configured && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(configured)
    ? configured
    : DEFAULT_AGENT_RUNTIME_VERSION;
}

function runtimeNodeOptions() {
  const currentOptions = (process.env.NODE_OPTIONS?.trim() || "")
    .split(/\s+/)
    .filter((option) => option && option !== "--no-network-family-autoselection");
  const required = [
    `--require=${RUNTIME_PROXY_PRELOAD_PATH}`,
  ];
  const nextOptions = required.filter((option) => !currentOptions.includes(option));
  return [...currentOptions, ...nextOptions].join(" ");
}

function isCompatibleRuntimeNode(nodePath: string) {
  if (!nodePath) return false;

  if (nodePath === process.execPath) {
    const [major, minor] = process.versions.node.split(".").map(Number);
    return major > MIN_RUNTIME_NODE_MAJOR
      || (major === MIN_RUNTIME_NODE_MAJOR && minor >= MIN_RUNTIME_NODE_MINOR);
  }

  try {
    execFileSync(nodePath, [
      "-e",
      `const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > ${MIN_RUNTIME_NODE_MAJOR} || (major === ${MIN_RUNTIME_NODE_MAJOR} && minor >= ${MIN_RUNTIME_NODE_MINOR}) ? 0 : 1)`,
    ], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runtimeNodeCandidates() {
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const inheritedPath = (process.env[pathKey] || "").split(path.delimiter).filter(Boolean);
  const configured = process.env.NODE_BIN_OVERRIDE?.trim();
  const nvmNode = process.env.NVM_BIN?.trim() ? path.join(process.env.NVM_BIN.trim(), "node") : "";

  return [...new Set([
    configured,
    process.execPath,
    nvmNode,
    ...inheritedPath.map((entry) => path.join(entry, process.platform === "win32" ? "node.exe" : "node")),
  ].filter((candidate): candidate is string => Boolean(candidate)))];
}

function resolveRuntimeNodeExecutable() {
  const candidate = runtimeNodeCandidates().find(isCompatibleRuntimeNode);
  if (candidate) return candidate;

  throw new Error(`Agent Runtime 需要 Node.js >=${MIN_RUNTIME_NODE_MAJOR}.${MIN_RUNTIME_NODE_MINOR}.0，请设置 NODE_BIN_OVERRIDE 指向兼容的 Node.js`);
}

function resolveRuntimeNpmCli(nodePath: string) {
  const npmCliPath = path.resolve(path.dirname(nodePath), "../lib/node_modules/npm/bin/npm-cli.js");
  if (fs.existsSync(npmCliPath)) return npmCliPath;

  throw new Error(`未找到与 ${nodePath} 匹配的 npm，请设置 NODE_BIN_OVERRIDE 指向完整的 Node.js 安装`);
}

function withRuntimeToolPath(environment: NodeJS.ProcessEnv) {
  const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const inherited = (environment[pathKey] || "").split(path.delimiter).filter(Boolean);
  const entries = [LOCAL_TOOL_BIN_DIR, path.dirname(resolveRuntimeNodeExecutable()), ...inherited];
  return {
    ...environment,
    [pathKey]: [...new Set(entries)].join(path.delimiter),
  };
}

function resolveReportAgentToolsBaseUrl() {
  const explicitBaseUrl = process.env.REPORT_AGENT_TOOLS_BASE_URL?.trim();
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/+$/, "");

  const appPort = process.env.PORT?.trim();
  if (appPort) return `http://127.0.0.1:${appPort}`;

  try {
    return new URL(getWebAppUrl()).origin;
  } catch {
    return "http://127.0.0.1:3000";
  }
}

export function getReportAgentToolsBaseUrl() {
  return resolveReportAgentToolsBaseUrl();
}

function runtimeEnvironment(modelConfig: AgentModelConfig | null) {
  const env = withRuntimeToolPath({ ...process.env });
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

export type AgentRuntimeBrowserHostname = "localhost" | "127.0.0.1";

export function getAgentRuntimeBrowserHostname(hostHeader: string | null | undefined): AgentRuntimeBrowserHostname {
  try {
    const hostname = new URL(`http://${hostHeader || ""}`).hostname.toLowerCase();
    return hostname === "localhost" ? "localhost" : "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

export async function getAgentRuntimeBrowserAuthUrl(browserHostname: AgentRuntimeBrowserHostname = "127.0.0.1") {
  const status = await getAgentRuntimeStatus();
  if (!status.running) return null;

  const token = readLatestRuntimeLaunchToken();
  if (!token) return null;

  const url = new URL(getAgentRuntimeUrl());
  url.hostname = browserHostname;
  url.pathname = "/";
  url.searchParams.set("token", token);
  return url.href;
}

export function getAgentRuntimeExecutionConfig(workingDirectory: string) {
  const modelConfig = readModelConfig();
  prepareManagedAgentRuntimeHome();
  if (modelConfig) writeModelConfig(modelConfig);
  const workspaceDirectory = path.resolve(workingDirectory);
  return {
    command: resolveRuntimeNodeExecutable(),
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
  imageModel?: string;
  imageEnabled?: boolean;
  imageBaseUrl?: string;
  imageApiKey?: string;
};

export type AgentModelConfigView = Omit<AgentModelConfig, "apiKey" | "imageApiKey"> & {
  imageApiKeyConfigured: boolean;
  imageApiKeyPreview: string;
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
  webAuthCookie?: string | null;
  startedAt?: string | null;
  lastAction?: AgentRuntimeAction | null;
  lastActionAt?: string | null;
};

type ManagedRuntimePackageJson = {
  name?: unknown;
  private?: unknown;
  version?: unknown;
  dependencies?: unknown;
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

function managedRuntimePackageJson() {
  return {
    name: "agent-runtime-managed",
    private: true,
    version: "0.0.0",
    dependencies: {
      "@deepseek-ai/dsh": getAgentRuntimePackageVersion(),
      pnpm: MANAGED_PNPM_VERSION,
    },
  };
}

function readManagedRuntimePackageJson(): ManagedRuntimePackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(INSTALL_DIR, "package.json"), "utf8")) as ManagedRuntimePackageJson;
  } catch {
    return null;
  }
}

function isManagedRuntimePackageJsonCurrent(current: ManagedRuntimePackageJson | null) {
  const expected = managedRuntimePackageJson();
  const dependencies = current?.dependencies;
  return Boolean(
    current?.name === expected.name
    && current.private === expected.private
    && current.version === expected.version
    && dependencies
    && typeof dependencies === "object"
    && !Array.isArray(dependencies)
    && Object.keys(dependencies).length === Object.keys(expected.dependencies).length
    && (dependencies as Record<string, unknown>)["@deepseek-ai/dsh"] === expected.dependencies["@deepseek-ai/dsh"]
    && (dependencies as Record<string, unknown>).pnpm === expected.dependencies.pnpm,
  );
}

function isManagedRuntimeManifestCurrent() {
  return isManagedRuntimePackageJsonCurrent(readManagedRuntimePackageJson());
}

function ensureInstallWorkspace() {
  ensureDirectories();
  const packageJsonPath = path.join(INSTALL_DIR, "package.json");

  const packageJson = managedRuntimePackageJson();
  const manifestChanged = !isManagedRuntimePackageJsonCurrent(readManagedRuntimePackageJson());
  if (manifestChanged) {
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }
  return manifestChanged;
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

function syncProjectSkillToRuntime(skillName: string) {
  const sourcePath = path.join(PROJECT_SKILLS_DIR, skillName, "SKILL.md");
  if (!fs.existsSync(sourcePath)) return;

  const targetPath = path.join(RUNTIME_SKILLS_DIR, skillName, "SKILL.md");
  const source = fs.readFileSync(sourcePath);
  if (fs.existsSync(targetPath) && source.equals(fs.readFileSync(targetPath))) return;

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(targetPath), `.SKILL-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, source);
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

export function syncReportAgentSkillsToRuntime() {
  ensureDirectories();
  syncProjectSkillToRuntime("bi-report-editor");
  syncProjectSkillToRuntime("datatalk-image-gen");
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
        imageEnabled: typeof parsed.imageEnabled === "boolean" ? parsed.imageEnabled : Boolean(parsed.imageModel),
        ...(typeof parsed.imageBaseUrl === "string" && parsed.imageBaseUrl.trim() ? { imageBaseUrl: parsed.imageBaseUrl.trim().replace(/\/+$/, "") } : {}),
        ...(typeof parsed.imageApiKey === "string" && parsed.imageApiKey.trim() ? { imageApiKey: parsed.imageApiKey.trim() } : {}),
        ...(typeof parsed.imageModel === "string" && parsed.imageModel.trim()
          ? { imageModel: parsed.imageModel.trim() }
          : {}),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function writeModelConfig(config: AgentModelConfig) {
  ensureDirectories();
  fs.writeFileSync(MODEL_CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.chmodSync(MODEL_CONFIG_PATH, 0o600);
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(RUNTIME_CREDENTIALS_PATH, stringifyYaml({
    [MODEL_API_KEY_ENV]: config.apiKey,
  }), { mode: 0o600 });
  fs.chmodSync(RUNTIME_CREDENTIALS_PATH, 0o600);
  // GPT-6 models on Chat Completions reject function tools unless
  // reasoning_effort is explicitly `none`. The harness's `off` level normally
  // omits the wire parameter, so declare its wire spelling for this family
  // and make it the managed route default. Other models retain their catalog
  // defaults.
  const gpt6ChatCompletions = /^gpt-6(?:-|$)/i.test(config.model);
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
          ...(gpt6ChatCompletions ? { reasoning: "off" } : {}),
          models: [
            {
              id: config.model,
              ...(gpt6ChatCompletions
                ? { reasoningEfforts: { off: "none", medium: "medium" } }
                : {}),
            },
          ],
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
    imageModel: config.imageModel || "",
    imageEnabled: config.imageEnabled ?? Boolean(config.imageModel),
    imageBaseUrl: config.imageBaseUrl || config.baseUrl,
    imageApiKeyConfigured: Boolean(config.imageApiKey),
    imageApiKeyPreview: config.imageApiKey ? (config.imageApiKey.length > 8 ? `${config.imageApiKey.slice(0, 4)}••••${config.imageApiKey.slice(-4)}` : "••••") : "",
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyPreview: config.apiKey ? `${config.apiKey.slice(0, 4)}••••${config.apiKey.slice(-4)}` : "",
  };
}

export function getAgentModelConfig() {
  return modelConfigView(readModelConfig());
}

export function getConfiguredAgentModelCredentials() {
  const config = readModelConfig();
  return config ? { ...config } : null;
}

/**
 * Prefer the current OpenAI Chat Completions parameter. Older private
 * OpenAI-compatible proxies may only accept `max_tokens`, so fall back to
 * the legacy parameter only when the provider explicitly rejects the
 * standard `max_completion_tokens` parameter. Do not send `temperature`:
 * some current OpenAI models accept only the default value, and omitting it
 * also remains compatible with older proxies.
 */
async function postChatCompletion(baseUrl: string, apiKey: string, body: Record<string, unknown>, timeoutMs: number) {
  const send = (tokenParameter: "max_tokens" | "max_completion_tokens") => {
    const { max_tokens, max_completion_tokens, ...rest } = body;
    const tokenLimit = max_tokens ?? max_completion_tokens;
    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...rest, ...(tokenLimit === undefined ? {} : { [tokenParameter]: tokenLimit }) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  };

  const response = await send("max_completion_tokens");
  if (response.ok) return response;

  const detail = await response.clone().text();
  const rejectsStandardTokenLimit = /unsupported parameter\s*:?\s*["'`]?max_completion_tokens|["'`]max_completion_tokens["'`].{0,100}(?:not supported|unsupported)|use\s+["'`]max_tokens["'`]/i.test(detail);
  return rejectsStandardTokenLimit ? send("max_tokens") : response;
}

export async function requestConfiguredAgentCompletion(input: {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}) {
  const config = readModelConfig();
  if (!config) return null;

  const response = await postChatCompletion(config.baseUrl, config.apiKey, {
      model: config.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      max_tokens: input.maxTokens ?? 700,
    }, input.timeoutMs ?? 12000);

  if (!response.ok) throw new Error(`模型请求失败（${response.status}）`);
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

async function verifyAgentModelConfig(baseUrl: string, apiKey: string, model: string) {
  const response = await postChatCompletion(baseUrl, apiKey, {
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "请识别这张图片中的主色，并只回复颜色名称。" },
          { type: "image_url", image_url: { url: VISION_PROBE_DATA_URL } },
        ],
      }],
      max_tokens: 16,
    }, 15000);

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    const imageUnsupported = /image_url|image input|vision|图片.{0,8}(?:不支持|unsupported)|(?:不支持|unsupported).{0,8}图片/i.test(detail);
    const reason = imageUnsupported ? "当前模型或代理不支持图片输入" : "模型服务返回错误";
    throw new Error(`模型配置校验失败：${reason}（${response.status}）${detail ? `：${detail}` : ""}`);
  }
}

export async function saveAgentModelConfig(input: Partial<AgentModelConfig> & { clearImageApiKey?: boolean }, keepExistingApiKey = true) {
  const existing = readModelConfig();
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim().replace(/\/+$/, "") : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const imageModel = typeof input.imageModel === "string"
    ? input.imageModel.trim()
    : existing?.imageModel || "";
  const apiKey = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : keepExistingApiKey && existing?.apiKey ? existing.apiKey : "";

  if (!baseUrl || !model || !apiKey) throw new Error("请填写完整的模型地址、API Key 和模型名称");
  new URL(baseUrl);
  await verifyAgentModelConfig(baseUrl, apiKey, model);
  const imageApiKey = input.clearImageApiKey ? "" : input.imageApiKey?.trim() || existing?.imageApiKey || "";
  const nextConfig: AgentModelConfig = { ...(existing?.imageBaseUrl ? { imageBaseUrl: existing.imageBaseUrl } : {}), imageEnabled: existing?.imageEnabled ?? Boolean(imageModel), baseUrl, apiKey, model, ...(imageModel ? { imageModel } : {}), ...(imageApiKey ? { imageApiKey } : {}) };
  writeModelConfig(nextConfig);
  return modelConfigView(nextConfig);
}

/** Scoped settings actions: testing never writes; saving never calls a provider. */
export async function updateScopedModelConfig(section: "chat" | "image", action: "test" | "save", input: Partial<AgentModelConfig> & { clearImageApiKey?: boolean }) {
  const existing = readModelConfig();
  let next: AgentModelConfig;
  if (section === "chat") {
    const baseUrl = input.baseUrl?.trim().replace(/\/+$/, "") || "";
    const model = input.model?.trim() || "";
    const apiKey = input.apiKey?.trim() || existing?.apiKey || "";
    if (!baseUrl || !model || !apiKey) throw new Error("请填写完整的模型地址、API Key 和模型名称");
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("请填写有效的 HTTP(S) 服务地址");
    next = { ...existing, ...(existing?.imageModel ? { imageBaseUrl: existing.imageBaseUrl || existing.baseUrl, imageApiKey: existing.imageApiKey || existing.apiKey } : {}), baseUrl, model, apiKey };
    if (action === "test") await verifyAgentModelConfig(baseUrl, apiKey, model);
  } else {
    if (!existing) throw new Error("请先完成 Runtime 的初始模型配置");
    const imageBaseUrl = input.imageBaseUrl === undefined ? existing.imageBaseUrl || existing.baseUrl : input.imageBaseUrl.trim().replace(/\/+$/, "");
    if (!imageBaseUrl) throw new Error("请填写图片服务地址");
    const imageUrl = new URL(imageBaseUrl);
    if (!["http:", "https:"].includes(imageUrl.protocol) || imageUrl.username || imageUrl.password || imageUrl.search || imageUrl.hash) throw new Error("请填写有效的 HTTP(S) 图片服务地址");
    if (imageBaseUrl !== (existing.imageBaseUrl || existing.baseUrl) && (!input.imageApiKey?.trim() || input.clearImageApiKey)) throw new Error("图片服务地址已变更，请填写该服务的 API Key，避免向新服务发送原密钥");
    next = { ...existing, imageBaseUrl, imageModel: input.imageModel?.trim() || "", imageEnabled: input.imageEnabled ?? existing.imageEnabled ?? Boolean(existing.imageModel) };
    if (action === "save" && next.imageEnabled && !next.imageModel) throw new Error("启用图片生成前请填写模型名称");
    const imageApiKey = input.clearImageApiKey ? "" : input.imageApiKey?.trim() || existing.imageApiKey || "";
    if (!imageApiKey && imageBaseUrl !== existing.baseUrl) throw new Error("独立图片服务必须配置自己的 API Key，不能共用对话服务密钥");
    if (imageApiKey) next.imageApiKey = imageApiKey;
    else delete next.imageApiKey;
    if (action === "test") {
      if (!next.imageModel) throw new Error("请填写图片模型名称");
      const response = await fetch(`${next.imageBaseUrl}/images/generations`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(180000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${next.imageApiKey || next.apiKey}` },
        body: JSON.stringify({ model: next.imageModel, prompt: "A plain blue circle on a white background, no text.", size: "1024x1024", quality: "low", n: 1 }),
      });
      if (!response.ok) throw new Error(`图片模型测试失败（${response.status}），请检查模型和密钥`);
      const result = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
      if (!result.data?.some(item => item.b64_json || item.url)) throw new Error("图片服务未返回有效图片");
    }
  }
  if (action === "test") return null;
  writeModelConfig(next);
  return modelConfigView(next);
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
  fs.writeFileSync(STATE_PATH, JSON.stringify(nextState, null, 2), { mode: 0o600 });
  fs.chmodSync(STATE_PATH, 0o600);
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

let runtimeAuthCookiePromise: Promise<string | null> | null = null;

function readLatestRuntimeLaunchToken() {
  if (!fs.existsSync(LOG_PATH)) return null;
  const log = fs.readFileSync(LOG_PATH, "utf8");
  const matches = [...log.matchAll(/dsh web:\s+\S+\?token=([A-Za-z0-9_-]+)/g)];
  return matches.at(-1)?.[1] || null;
}

function setRuntimeAuthCookie(cookie: string | null) {
  const state = readStateFile();
  if (cookie) {
    writeStateFile({ ...state, webAuthCookie: cookie });
    return;
  }

  if (!state.webAuthCookie) return;
  const nextState = { ...state };
  delete nextState.webAuthCookie;
  writeStateFile(nextState);
}

async function exchangeRuntimeLaunchToken(attempt = 0): Promise<string | null> {
  const status = await getAgentRuntimeStatus();
  if (!status.running) return null;

  const token = readLatestRuntimeLaunchToken();
  if (!token) {
    if (attempt >= AUTH_BOOTSTRAP_RETRIES) return null;
    await sleep(AUTH_BOOTSTRAP_RETRY_DELAY_MS);
    return exchangeRuntimeLaunchToken(attempt + 1);
  }

  const response = await fetch(`${getAgentRuntimeUrl()}/?token=${encodeURIComponent(token)}`, {
    redirect: "manual",
    cache: "no-store",
  });
  if (response.status !== 303) return null;

  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookie = headers.getSetCookie?.()[0] || headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0]?.trim() || null;
  if (cookie) setRuntimeAuthCookie(cookie);
  return cookie;
}

export async function getAgentRuntimeAuthCookie(forceRefresh = false) {
  if (!forceRefresh) {
    const state = readStateFile();
    if (state.webAuthCookie) return state.webAuthCookie;
  } else {
    setRuntimeAuthCookie(null);
  }

  if (runtimeAuthCookiePromise) return runtimeAuthCookiePromise;
  runtimeAuthCookiePromise = exchangeRuntimeLaunchToken().finally(() => {
    runtimeAuthCookiePromise = null;
  });
  return runtimeAuthCookiePromise;
}

export async function fetchAgentRuntime(pathname: string, init: RequestInit = {}) {
  const request = async (forceRefresh: boolean) => {
    const cookie = await getAgentRuntimeAuthCookie(forceRefresh);
    const headers = new Headers(init.headers);
    if (cookie) headers.set("Cookie", cookie);
    return fetch(new URL(pathname, getAgentRuntimeUrl()), { ...init, headers });
  };

  const response = await request(false);
  return response.status === 401 ? request(true) : response;
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
      if (!command.includes("npm install @deepseek-ai/dsh@")) continue;
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
        if (!command.includes("npm install @deepseek-ai/dsh@")) continue;
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
  const requestedVersion = getAgentRuntimePackageVersion();
  const installedVersion = readInstalledVersion();
  const installed = installedVersion === requestedVersion
    && fs.existsSync(LOCAL_BIN_PATH)
    && fs.existsSync(LOCAL_PNPM_PATH)
    && isManagedRuntimeManifestCurrent();
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
    const success = Boolean(readInstalledVersion())
      && fs.existsSync(LOCAL_BIN_PATH)
      && fs.existsSync(LOCAL_PNPM_PATH);
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
    requestedVersion,
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
  const manifestChanged = ensureInstallWorkspace();
  if (manifestChanged) {
    // A persisted manifest can carry direct dependencies from an older
    // Runtime generation. Reusing that tree can load multiple scope copies.
    fs.rmSync(path.join(INSTALL_DIR, "node_modules"), { recursive: true, force: true });
    fs.rmSync(path.join(INSTALL_DIR, "package-lock.json"), { force: true });
  }
  const current = readStateFile();
  if (isManagedProcessRunning(current.installPid)) {
    return;
  }

  const startedAt = new Date().toISOString();
  const requestedVersion = getAgentRuntimePackageVersion();
  const runtimeNode = resolveRuntimeNodeExecutable();
  const npmCli = resolveRuntimeNpmCli(runtimeNode);
  appendLogDivider(INSTALL_LOG_PATH, `开始安装 @deepseek-ai/dsh@${requestedVersion}`);
  const logFd = fs.openSync(INSTALL_LOG_PATH, "a");
  const child = spawn(runtimeNode, [npmCli,
    "install",
    `@deepseek-ai/dsh@${requestedVersion}`,
    "--save-exact",
    "--foreground-scripts",
  ], {
    cwd: INSTALL_DIR,
    env: {
      ...withRuntimeToolPath({ ...process.env }),
      NODE_OPTIONS: [runtimeNodeOptions(), INSTALL_HEAP_OPTION]
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
    const success = code === 0
      && readInstalledVersion() === requestedVersion
      && fs.existsSync(LOCAL_BIN_PATH)
      && fs.existsSync(LOCAL_PNPM_PATH);
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
  // npm can replace the files on disk while dsh web keeps the old modules in
  // memory. Stop it before an update so the next start uses one coherent tree.
  if (isManagedProcessRunning(current.pid)) {
    await stopAgentRuntime();
  }
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
  const runtimeNode = resolveRuntimeNodeExecutable();
  syncProjectSkillsToRuntime();
  if (modelConfig) writeModelConfig(modelConfig);
  appendLogDivider(LOG_PATH, `启动 dsh web --port ${port} --no-open`);

  const logFd = fs.openSync(LOG_PATH, "a");
  const child = spawn(runtimeNode, [DSH_ENTRY_PATH, "web", "--port", String(port), "--no-open"], {
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
