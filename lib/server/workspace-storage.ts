import fs from "node:fs";
import path from "node:path";

function resolveWorkspaceStorageRoot() {
  const configuredRoot = process.env.WORKSPACE_STORAGE_ROOT?.trim();
  if (configuredRoot) return path.resolve(configuredRoot);

  const defaultContainerRoot = "/app/workspace";
  const cwd = process.cwd();
  if (process.env.NODE_ENV === "production" && (cwd === "/app" || cwd.startsWith("/app/") || fs.existsSync("/app"))) {
    return defaultContainerRoot;
  }

  return path.resolve(cwd, "..", "chat-bi-workspace");
}

export const WORKSPACE_STORAGE_ROOT = resolveWorkspaceStorageRoot();
const LEGACY_RUNTIME_ROOT = path.join(process.cwd(), ".runtime");
export const REPORT_WORKSPACE_ROOT = path.join(WORKSPACE_STORAGE_ROOT, "data");
export const RUNTIME_STORAGE_ROOT = path.join(WORKSPACE_STORAGE_ROOT, "runtime");
export const AGENT_RUNTIME_ROOT = path.join(RUNTIME_STORAGE_ROOT, "agent-runtime");
export const REPORT_AGENT_TOOL_SECRET_ROOT = path.join(RUNTIME_STORAGE_ROOT, "report-agent-tools");
export const PUBLIC_LINK_SECRET_ROOT = path.join(RUNTIME_STORAGE_ROOT, "public-links");

function isSamePath(leftPath: string, rightPath: string) {
  return path.resolve(leftPath) === path.resolve(rightPath);
}

function moveIfMissing(sourcePath: string, targetPath: string) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.renameSync(sourcePath, targetPath);
}

function migrateLegacyReportWorkspace() {
  if (!fs.existsSync(/*turbopackIgnore: true*/ WORKSPACE_STORAGE_ROOT)) return;

  fs.mkdirSync(REPORT_WORKSPACE_ROOT, { recursive: true });

  for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ WORKSPACE_STORAGE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!/^[1-9][0-9]*$/.test(entry.name)) continue;
    moveIfMissing(
      path.join(/*turbopackIgnore: true*/ WORKSPACE_STORAGE_ROOT, entry.name),
      path.join(REPORT_WORKSPACE_ROOT, entry.name),
    );
  }
}

function migrateLegacyRuntimeStorage() {
  if (!fs.existsSync(LEGACY_RUNTIME_ROOT)) return;
  if (isSamePath(LEGACY_RUNTIME_ROOT, WORKSPACE_STORAGE_ROOT)) return;

  if (!fs.existsSync(RUNTIME_STORAGE_ROOT)) {
    fs.mkdirSync(path.dirname(RUNTIME_STORAGE_ROOT), { recursive: true });
    fs.renameSync(LEGACY_RUNTIME_ROOT, RUNTIME_STORAGE_ROOT);
    return;
  }

  for (const entry of fs.readdirSync(LEGACY_RUNTIME_ROOT, { withFileTypes: true })) {
    moveIfMissing(
      path.join(LEGACY_RUNTIME_ROOT, entry.name),
      path.join(RUNTIME_STORAGE_ROOT, entry.name),
    );
  }

  try {
    if (fs.readdirSync(LEGACY_RUNTIME_ROOT).length === 0) {
      fs.rmdirSync(LEGACY_RUNTIME_ROOT);
    }
  } catch {
    // Ignore cleanup failures so runtime initialization can continue.
  }
}

export function ensureWorkspaceStorageLayout() {
  fs.mkdirSync(WORKSPACE_STORAGE_ROOT, { recursive: true });
  migrateLegacyReportWorkspace();
  migrateLegacyRuntimeStorage();
  fs.mkdirSync(REPORT_WORKSPACE_ROOT, { recursive: true });
  fs.mkdirSync(RUNTIME_STORAGE_ROOT, { recursive: true });
}
