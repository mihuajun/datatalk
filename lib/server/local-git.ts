import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

import { getReportWorkspacePath, resolveReportSourcePath } from "@/lib/server/report-workspace";

const exec = promisify(execFile);
const GITIGNORE = "# Runtime output is not part of report source history.\n*/runtime/\n.DS_Store\n";
const DEFAULT_GIT_USER_NAME = "BI Report Agent";
const DEFAULT_GIT_USER_EMAIL = "bi-report-agent@localhost";

function getGitIdentity() {
  const name = process.env.REPORT_GIT_USER_NAME?.trim() || DEFAULT_GIT_USER_NAME;
  const email = process.env.REPORT_GIT_USER_EMAIL?.trim() || DEFAULT_GIT_USER_EMAIL;
  return { name, email };
}

async function ensureGitMetadata(cwd: string) {
  await fs.mkdir(cwd, { recursive: true });
  try { await fs.access(`${cwd}/.git`); } catch { await exec("git", ["init", cwd]); }

  const ignorePath = `${cwd}/.gitignore`;
  let content = "";
  try { content = await fs.readFile(ignorePath, "utf8"); } catch { /* create below */ }
  if (!content.includes("*/runtime/")) {
    await fs.writeFile(ignorePath, content ? `${content.trimEnd()}\n${GITIGNORE}` : GITIGNORE);
  }
}

async function git(tenantId: number, reportCode: string, args: string[]) {
  const cwd = getReportWorkspacePath(tenantId, reportCode);
  await ensureGitMetadata(cwd);
  return exec("git", ["-C", cwd, ...args]);
}

export async function getWorkspaceHead(tenantId: number, reportCode: string) { try { return (await git(tenantId, reportCode, ["rev-parse", "HEAD"])).stdout.trim(); } catch { return null; } }
export async function getWorkspaceDiff(tenantId: number, reportCode: string) { return (await git(tenantId, reportCode, ["diff", "--no-ext-diff"])).stdout; }
export type WorkspaceStatusEntry = {
  path: string;
  status: string;
};

export type WorkspaceStatusScope = "all" | "working";

export async function getWorkspaceStatusEntries(tenantId: number, reportCode: string, scope: WorkspaceStatusScope = "all"): Promise<WorkspaceStatusEntry[]> {
  const args = ["status", "--short", "--untracked-files=all"];
  if (scope === "working") args.push("--", "working");
  const output = (await git(tenantId, reportCode, args)).stdout;
  const prefix = "working/";
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3).replaceAll("\\", "/");
      const normalizedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) || rawPath : rawPath;
      return { status, path: normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath };
    });
}

export async function getWorkspaceStatus(tenantId: number, reportCode: string, scope: WorkspaceStatusScope = "all") {
  return (await getWorkspaceStatusEntries(tenantId, reportCode, scope)).map((entry) => entry.path);
}
export async function writeReportSourceFile(tenantId: number, reportCode: string, fileName: string, content: string) {
  const filePath = resolveReportSourcePath(tenantId, reportCode, fileName);
  await fs.mkdir(filePath.substring(0, filePath.lastIndexOf("/")), { recursive: true });
  await fs.writeFile(filePath, content);
}
export async function deleteReportSourceFile(tenantId: number, reportCode: string, fileName: string) {
  await fs.rm(resolveReportSourcePath(tenantId, reportCode, fileName), { force: true });
}
export type WorkspaceCommitScope = "working" | "knowledge";

export async function commitWorkspace(tenantId: number, reportCode: string, message: string, opId: string, scope: WorkspaceCommitScope = "working") {
  if (!message.trim() || !opId.trim()) throw new Error("INVALID_COMMIT_METADATA");
  const trackedFiles = (await git(tenantId, reportCode, ["ls-files", "-z"])).stdout.split("\0").filter(Boolean);
  const trackedRuntimeFiles = trackedFiles.filter((file) => /(?:^|\/)runtime\//.test(file));
  if (trackedRuntimeFiles.length) await git(tenantId, reportCode, ["rm", "--cached", "--ignore-unmatch", "--", ...trackedRuntimeFiles]);
  await git(tenantId, reportCode, ["add", "--", scope === "knowledge" ? "_knowledge" : "working"]);
  const { name, email } = getGitIdentity();
  await git(tenantId, reportCode, [
    "-c", `user.name=${name}`,
    "-c", `user.email=${email}`,
    "commit", "--allow-empty", "-m", `${message.trim()} [opId:${opId.trim()}]`,
  ]);
  return getWorkspaceHead(tenantId, reportCode);
}
export async function restoreWorkspace(tenantId: number, reportCode: string, commitHash: string) {
  if (!/^[a-f0-9]{7,64}$/.test(commitHash)) throw new Error("INVALID_COMMIT_HASH");
  await git(tenantId, reportCode, ["reset", "--hard", commitHash]);
}
