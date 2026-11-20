/** File transport + isolated source snapshot; does NOT publish or bypass the normal commit path. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { OpenApiError, requireApiScope, type ApiPrincipal } from "@/lib/server/open-api-auth";
import { previewParentIdentity } from "@/lib/server/studio-preview";
import { getReportDetailByCode } from "@/lib/server/report-repository";
import { getReportWorkspacePath, getReportWorkingPath, isAllowedReportSourceFile } from "@/lib/server/report-workspace";
import { withReportDevelopmentRoot } from "@/lib/server/report-development-context";
import { validateReportWorkspace } from "@/lib/server/report-schema";
import { getWorkspaceHead, getWorkspaceStatus } from "@/lib/server/local-git";
import { composeWebReportSrcDoc, type WebFileMap } from "@/lib/report-web";
import { executeReportDataRequest } from "@/lib/server/report-data-runtime";

const FILE_LIMIT = 512 * 1024;
const TOTAL_LIMIT = 16 * 1024 * 1024;
const TTL = 60 * 60 * 1000;
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const fail = (code: string, status: number, message: string): never => { throw new OpenApiError(code, status, message); };
export const developmentFileSchema = z.object({ path: z.string().min(1).max(200), size: z.number().int().min(0).max(FILE_LIMIT), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type FileEntry = z.infer<typeof developmentFileSchema>;
type Session = {
  id: string; tenantId: number; userId: number; keyId: number; oauthGrantId?: string;
  reportCode: string; baseCommitHash: string; expiresAt: number; tokenHash: string;
  files: FileEntry[]; baseline: FileEntry[]; deleteFiles: string[];
};
export function assertDevelopmentPath(file: string) {
  if (!isAllowedReportSourceFile(file) || file.includes("\\") || file.split("/").some(p => !p || p === "." || p === "..") || /\.(xlsx|xls)$/i.test(file)) {
    fail("REPORT_FILE_NOT_ALLOWED", 400, "首期只支持白名单 UTF-8 源码/文本文件，不接受压缩包、凭据、目录或二进制文件");
  }
}
export function decodeDevelopmentFile(bytes: Buffer) {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return fail("INVALID_FILE_ENCODING", 400, "文件必须是有效 UTF-8；不能使用 Base64 替代二进制上传"); }
}
export function verifyDevelopmentFile(bytes: Buffer, entry: FileEntry) {
  if (bytes.length !== entry.size || sha(bytes) !== entry.sha256) fail("FILE_HASH_MISMATCH", 422, "文件字节数或 SHA-256 与清单不一致");
  const text = decodeDevelopmentFile(bytes);
  if (text.includes("\0")) fail("INVALID_FILE_ENCODING", 400, "不接受含 NUL 的二进制内容");
  return text;
}
function directory(tenantId: number, reportCode: string, id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) fail("DEVELOPMENT_NOT_FOUND", 404, "开发会话不存在");
  return path.join(getReportWorkspacePath(tenantId, reportCode), ".development", id);
}
function scopeOwner(session: Session, principal: ApiPrincipal) {
  if (session.tenantId !== principal.tenantId || session.userId !== principal.userId || session.keyId !== principal.keyId || (session.oauthGrantId || null) !== (principal.oauthGrantId || null)) {
    fail("DEVELOPMENT_NOT_FOUND", 404, "开发会话不存在或不属于当前连接");
  }
}
async function load(tenantId: number, reportCode: string, id: string): Promise<Session> {
  let value: Session;
  try { value = JSON.parse(await fs.readFile(path.join(directory(tenantId, reportCode, id), "session.json"), "utf8")); }
  catch { return fail("DEVELOPMENT_NOT_FOUND", 404, "开发会话不存在"); }
  if (value.id !== id || value.tenantId !== tenantId || value.reportCode !== reportCode) fail("DEVELOPMENT_NOT_FOUND", 404, "开发会话不存在");
  if (value.expiresAt <= Date.now()) fail("DEVELOPMENT_EXPIRED", 410, "开发会话已过期，请重新读取版本并创建会话");
  return value;
}
async function ensureParent(session: Session) {
  const principal = await previewParentIdentity({ tenant_id: session.tenantId, user_id: session.userId, key_id: session.keyId, oauth_grant_id: session.oauthGrantId || null });
  if (!principal) fail("DEVELOPMENT_REVOKED", 401, "来源连接已撤销或账号已停用");
  requireApiScope(principal!, "reports:write");
  requireApiScope(principal!, "reports:read");
  if (!await getReportDetailByCode(session.tenantId, session.reportCode)) fail("REPORT_NOT_FOUND", 404, "报表不存在");
  return principal!;
}
async function regularRead(file: string) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("REPORT_FILE_NOT_ALLOWED", 400, "不允许符号链接或特殊文件");
  if (stat.size > FILE_LIMIT) fail("FILE_LIMIT", 413, "开发会话单文件不能超过 512KB");
  return fs.readFile(file);
}
async function snapshot(source: string, destination: string) {
  const entries: FileEntry[] = []; let total = 0;
  async function walk(relative: string) {
    for (const item of await fs.readdir(path.join(source, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${item.name}` : item.name;
      if (item.isSymbolicLink()) fail("REPORT_FILE_NOT_ALLOWED", 400, "工作区含符号链接，拒绝创建快照");
      if (item.isDirectory() && ["assets", "components", "data"].includes(file.split("/")[0])) { await walk(file); continue; }
      if (!item.isFile()) continue;
      if (!isAllowedReportSourceFile(file)) {
        if (["assets", "components", "data"].includes(file.split("/")[0])) fail("REPORT_FILE_NOT_ALLOWED", 400, "现有报表包含首期不支持的资源，不能创建不完整预览；请保留原开发路径");
        continue;
      }
      assertDevelopmentPath(file);
      const bytes = await regularRead(path.join(source, file));
      const entry = { path: file, size: bytes.length, sha256: sha(bytes) };
      verifyDevelopmentFile(bytes, entry); total += bytes.length;
      if (total > TOTAL_LIMIT || entries.length >= 100) fail("WORKSPACE_LIMIT", 413, "源码快照超过 16MB 或 100 个文件");
      await fs.mkdir(path.dirname(path.join(destination, file)), { recursive: true });
      await fs.writeFile(path.join(destination, file), bytes, { mode: 0o600, flag: "wx" });
      entries.push(entry);
    }
  }
  await walk(""); return entries.sort((a, b) => a.path.localeCompare(b.path));
}
export async function beginReportDevelopment(principal: ApiPrincipal, args: { reportCode: string; baseCommitHash: string; files: FileEntry[]; deleteFiles?: string[] }, baseUrl: string) {
  requireApiScope(principal, "reports:read");
  const names = new Set<string>(); let total = 0;
  for (const entry of args.files) {
    assertDevelopmentPath(entry.path);
    if (names.has(entry.path)) fail("INVALID_FILE_MANIFEST", 400, "文件路径不能重复");
    names.add(entry.path); total += entry.size;
  }
  if (total > TOTAL_LIMIT) fail("WORKSPACE_LIMIT", 413, "上传总量不能超过 16MB");
  const deletes = args.deleteFiles || [];
  for (const file of deletes) {
    assertDevelopmentPath(file);
    if (file === "report.json" || names.has(file)) fail("INVALID_FILE_MANIFEST", 400, "删除列表无效");
  }
  const { tenantId, userId, keyId, oauthGrantId } = principal;
  if (!await getReportDetailByCode(tenantId, args.reportCode)) fail("REPORT_NOT_FOUND", 404, "报表不存在");
  if (await getWorkspaceHead(tenantId, args.reportCode) !== args.baseCommitHash || (await getWorkspaceStatus(tenantId, args.reportCode, "working")).length) fail("WORKING_BASE_CONFLICT", 409, "先读取干净的最新报表版本");
  const parent = path.join(getReportWorkspacePath(tenantId, args.reportCode), ".development");
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  let active = 0;
  for (const item of await fs.readdir(parent, { withFileTypes: true })) {
    if (!item.isDirectory() || !/^[a-f0-9]{32}$/.test(item.name)) continue;
    const root = path.join(parent, item.name);
    const stat = await fs.stat(root);
    let expiry = stat.mtimeMs + TTL * 2;
    try { expiry = Number(JSON.parse(await fs.readFile(path.join(root, "session.json"), "utf8")).expiresAt); } catch { /* abandoned initialization expires by age */ }
    if (expiry <= Date.now()) await fs.rm(root, { recursive: true, force: true });
    else active++;
  }
  if (active >= 8) fail("DEVELOPMENT_LIMIT", 429, "当前报表开发会话过多，请先关闭旧会话");
  const id = randomBytes(16).toString("hex"); const token = randomBytes(32).toString("base64url");
  const root = directory(tenantId, args.reportCode, id);
  await fs.mkdir(path.join(root, "baseline"), { recursive: true, mode: 0o700 });
  try {
    const baseline = await snapshot(getReportWorkingPath(tenantId, args.reportCode), path.join(root, "baseline"));
    const session: Session = { id, tenantId, userId, keyId, oauthGrantId, reportCode: args.reportCode, baseCommitHash: args.baseCommitHash, files: args.files, baseline, deleteFiles: deletes, tokenHash: sha(token), expiresAt: Date.now() + TTL };
    await fs.writeFile(path.join(root, "session.json"), JSON.stringify(session), { mode: 0o600, flag: "wx" });
    const endpoint = `${baseUrl}/api/open/report-development/${tenantId}/${args.reportCode}/${id}`;
    return { sessionId: id, reportCode: args.reportCode, baseCommitHash: args.baseCommitHash, expiresAt: new Date(session.expiresAt).toISOString(), files: baseline, uploadManifest: args.files, transfer: { endpoint, authorization: `Bearer ${token}`, download: "GET ?path=<encoded baseline path>", upload: "PUT ?path=<encoded manifest path>, raw UTF-8 bytes, Content-Type: application/octet-stream", note: "临时凭据只交给文件传输工具；禁止写入报表、日志或最终答复。无传输能力则使用原有 JSON 工具，不声称已上传。" }, runtime: "cloud-development", saved: false, published: false };
  } catch (e) { await fs.rm(root, { recursive: true, force: true }); throw e; }
}
export async function ownedDevelopment(principal: ApiPrincipal, reportCode: string, id: string) {
  const session = await load(principal.tenantId, reportCode, id); scopeOwner(session, principal); await ensureParent(session); return session;
}
export async function authorizeDevelopmentTransfer(tenantId: number, reportCode: string, id: string, token: string, preview = false) {
  const session = await load(tenantId, reportCode, id);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail("INVALID_DEVELOPMENT_TOKEN", 401, "开发凭据无效");
  if (preview) {
    let expires = 0;
    try { expires = Number(await fs.readFile(path.join(directory(tenantId, reportCode, id), `preview-${sha(token)}`), "utf8")); } catch { /* fail closed */ }
    if (expires <= Date.now()) fail("INVALID_DEVELOPMENT_TOKEN", 401, "预览凭据已过期");
  } else if (sha(token) !== session.tokenHash) fail("INVALID_DEVELOPMENT_TOKEN", 401, "开发凭据无效");
  await ensureParent(session); return session;
}
export async function transferDevelopmentFile(session: Session, file: string, request?: Request) {
  assertDevelopmentPath(file);
  const root = directory(session.tenantId, session.reportCode, session.id);
  if (!request) {
    const entry = session.baseline.find(item => item.path === file);
    if (!entry) fail("REPORT_FILE_NOT_ALLOWED", 404, "文件不在基线清单");
    const bytes = await regularRead(path.join(root, "baseline", file)); verifyDevelopmentFile(bytes, entry!); return bytes;
  }
  const entry = session.files.find(item => item.path === file);
  if (!entry) fail("REPORT_FILE_NOT_ALLOWED", 400, "文件不在上传清单");
  if (Number(request.headers.get("content-length")) > entry!.size) fail("FILE_LIMIT", 413, "上传内容超过清单大小");
  const chunks: Uint8Array[] = []; let size = 0; const reader = request.body?.getReader();
  if (reader) for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > entry!.size || size > FILE_LIMIT) { await reader.cancel(); fail("FILE_LIMIT", 413, "上传内容过大"); }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks); verifyDevelopmentFile(bytes, entry!);
  await fs.mkdir(path.join(root, "blobs"), { recursive: true });
  const temporary = path.join(root, "blobs", `${entry!.sha256}.${randomUUID()}`);
  await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  await fs.rename(temporary, path.join(root, "blobs", entry!.sha256));
  return bytes;
}
async function uploadedChanges(session: Session) {
  const files: Record<string, string> = Object.create(null);
  for (const entry of session.files) {
    let bytes: Buffer;
    try { bytes = await regularRead(path.join(directory(session.tenantId, session.reportCode, session.id), "blobs", entry.sha256)); }
    catch { return fail("UPLOAD_INCOMPLETE", 409, "尚有文件未上传，请按原清单补齐"); }
    files[entry.path] = verifyDevelopmentFile(bytes, entry);
  }
  if (files["report.json"]) {
    let manifest;
    try { manifest = JSON.parse(files["report.json"]); } catch { return fail("INVALID_MANIFEST", 422, "report.json 无效"); }
    if (Number(manifest?.tenantId) !== session.tenantId || manifest?.reportCode !== session.reportCode) fail("INVALID_MANIFEST", 422, "不能修改报表身份");
  }
  return { files, deleteFiles: session.deleteFiles };
}
async function seal(session: Session) {
  const root = directory(session.tenantId, session.reportCode, session.id);
  const changes = await uploadedChanges(session);
  const sealed = path.join(root, "sealed");
  try { await fs.access(sealed); return sealed; } catch { /* first seal */ }
  const temp = path.join(root, `seal-${randomUUID()}`);
  try {
    await fs.cp(path.join(root, "baseline"), temp, { recursive: true });
    for (const [file, content] of Object.entries(changes.files)) {
      await fs.mkdir(path.dirname(path.join(temp, file)), { recursive: true });
      await fs.writeFile(path.join(temp, file), content);
    }
    for (const file of changes.deleteFiles) await fs.rm(path.join(temp, file), { force: true });
    try { await fs.rename(temp, sealed); } catch (e) {
      if (!["EEXIST", "ENOTEMPTY"].includes((e as NodeJS.ErrnoException).code || "")) throw e;
    }
    return sealed;
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
export async function inspectReportDevelopment(principal: ApiPrincipal, reportCode: string, id: string, baseUrl: string) {
  const session = await ownedDevelopment(principal, reportCode, id);
  const root = await seal(session);
  const validation = await withReportDevelopmentRoot(session.tenantId, reportCode, root, () => validateReportWorkspace(session.tenantId, reportCode));
  if (!validation.valid) return { sessionId: id, validation, saved: false, published: false, previewUrl: null };
  const token = randomBytes(32).toString("base64url"); const expires = Math.min(Date.now() + 10 * 60000, session.expiresAt);
  await fs.writeFile(path.join(directory(session.tenantId, reportCode, id), `preview-${sha(token)}`), String(expires), { mode: 0o600, flag: "wx" });
  return { sessionId: id, validation, baseCommitHash: session.baseCommitHash, files: session.files, saved: false, published: false, previewUrl: `${baseUrl}/api/open/report-development/${session.tenantId}/${reportCode}/${id}/preview#token=${token}`, previewExpiresAt: new Date(expires).toISOString(), acceptance: { structure: "passed", data: "not_checked", visual: "not_checked" }, note: "云端隔离源码快照，不是本地运行或进程沙箱；未修改正式工作区。预览凭据只读、不可上传/提交。" };
}
export async function developmentChangesForCommit(principal: ApiPrincipal, reportCode: string, id: string) {
  const session = await ownedDevelopment(principal, reportCode, id);
  return { session, ...await uploadedChanges(session) };
}
export async function closeReportDevelopment(principal: ApiPrincipal, reportCode: string, id: string) {
  const session = await ownedDevelopment(principal, reportCode, id);
  await fs.rm(directory(session.tenantId, reportCode, id), { recursive: true, force: true });
  return { closed: true, reportChanged: false };
}
export async function developmentPreview(session: Session, input?: { dataId: string; filters?: unknown }) {
  const principal = await ensureParent(session); const root = await seal(session);
  return withReportDevelopmentRoot(session.tenantId, session.reportCode, root, async () => {
    if (input) {
      requireApiScope(principal, "data:query");
      return { data: await executeReportDataRequest({ tenantId: session.tenantId, reportCode: session.reportCode, source: "working", ...input }) };
    }
    const files: WebFileMap = {};
    for (const file of ["page.html", "styles.css", "app.js"] as const) files[file] = await fs.readFile(path.join(root, file), "utf8");
    // Match normal report rendering for referenced asset files.
    files.assets = {};
    const names = new Set([...session.baseline, ...session.files].map(item => item.path));
    for (const name of names) if (name.startsWith("assets/") && !session.deleteFiles.includes(name)) {
      const bytes = await fs.readFile(path.join(root, name));
      const mime = name.endsWith(".svg") ? "image/svg+xml" : name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/plain";
      files.assets[name] = `data:${mime};base64,${bytes.toString("base64")}`;
    }
    return { srcdoc: composeWebReportSrcDoc(files), reportCode: session.reportCode, baseCommitHash: session.baseCommitHash };
  });
}

// Local preview sessions have an empty upload manifest. This capability can ONLY query,
// never accept source files, execute uploaded handlers, commit, or publish.
export async function prepareReportLocalPreview(principal: ApiPrincipal, args: { reportCode: string; baseCommitHash: string; dataSources?: string[] }, baseUrl: string) {
  const artifact = await fs.readFile(path.join(process.cwd(), "public/studio-runtime/studio-report-local.cjs"));
  const sources = [...new Set(args.dataSources || [])];
  if (sources.length) {
    requireApiScope(principal, "data:query");
    const { listReportAgentDataSources } = await import("@/lib/server/report-agent-tools");
    const available = await listReportAgentDataSources(principal.tenantId);
    if (sources.some(name => !available.some(s => s.name === name))) fail("DATA_SOURCE_NOT_FOUND", 404, "数据源不属于当前租户");
  }
  const result = await beginReportDevelopment(principal, { ...args, files: [] }, baseUrl);
  const token = randomBytes(32).toString("base64url");
  await fs.writeFile(path.join(directory(principal.tenantId, args.reportCode, result.sessionId), "local-query.json"), JSON.stringify({ tokenHash: sha(token), dataSources: sources }), { mode: 0o600, flag: "wx" });
  return { ...result, runtime: "local", localQuery: { endpoint: `${result.transfer.endpoint}/local-query`, authorization: `Bearer ${token}`, dataSources: sources },
    localRuntime: { version: "0.5.1", url: `${baseUrl}/studio-runtime/studio-report-local.cjs`, sha256: sha(artifact), node: ">=22.5", commands: ["pull <session.credentials.json> <workspace>", "serve <session.credentials.json> <workspace> [port]", "status <local-control.json>", "stop <local-control.json>"], note: "下载运行时并核对SHA256。凭据保存到源码目录外chmod600文件。WorkBuddy须在可见原生终端前台运行serve，或使用正式受管持久任务；禁止detached/unref逃离命令生命周期，禁止清除NODE_OPTIONS等客户端保护。打开后检查status.snapshots/handlerCalls实际增长，不把HTTP200或打开链接视为预览通过。serve只绑定127.0.0.1，启动输出含本地预览链接，control文件也仅本机保存。编辑后点击本地预览的刷新；不自动上传、不自动提交。server.js在本地执行，context.query只代理白名单数据源的只读SQL。可信开发者代码，不是恶意代码安全沙箱。" }, saved: false, published: false };
}
export const localQuerySchema = z.object({
  dataSourceRef: z.string().min(1).max(160), sql: z.string().min(1).max(30000),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))])).optional(),
  options: z.object({ timeoutMs: z.number().int().min(100).max(60000).optional(), maxRows: z.number().int().min(1).max(1000).optional(), maxBytes: z.number().int().min(1024).max(2097152).optional() }).strict().optional(),
}).strict();
export async function queryForLocalPreview(tenantId: number, reportCode: string, id: string, token: string, body: unknown) {
  const session = await load(tenantId, reportCode, id);
  let config: { tokenHash: string; dataSources: string[] };
  try { config = JSON.parse(await fs.readFile(path.join(directory(tenantId, reportCode, id), "local-query.json"), "utf8")); }
  catch { return fail("INVALID_LOCAL_QUERY_TOKEN", 401, "本地查询会话不存在"); }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || sha(token) !== config.tokenHash) fail("INVALID_LOCAL_QUERY_TOKEN", 401, "本地查询凭据无效");
  const principal = await ensureParent(session); requireApiScope(principal, "data:query");
  const input = localQuerySchema.safeParse(body);
  if (!input.success) fail("INVALID_ARGUMENTS", 400, "只接受数据源、SQL、绑定参数和查询限制；不接受报表源码");
  const args = input.data!;
  if (!config.dataSources.includes(args.dataSourceRef)) fail("DATA_SOURCE_NOT_ALLOWED", 403, "数据源未获本次本地预览授权");
  const { executeReportQuery } = await import("@/lib/server/report-query-gateway");
  try { return await executeReportQuery({ tenantId, ...args, ...args.options }); }
  catch (e) { const message = e instanceof Error ? e.message : "QUERY_FAILED"; throw new OpenApiError("LOCAL_QUERY_FAILED", 422, message.startsWith("QUERY_") || message.startsWith("DATA_SOURCE_") ? message.slice(0, 200) : "数据查询失败"); }
}
export async function inspectLocalPreviewBoundary(principal: ApiPrincipal, reportCode: string, id: string) {
  const session = await ownedDevelopment(principal, reportCode, id);
  if (session.files.length || session.deleteFiles.length) fail("NOT_LOCAL_PREVIEW_SESSION", 400, "不是只读本地预览会话");
  const current = await getWorkspaceHead(session.tenantId, reportCode);
  const root = getReportWorkingPath(session.tenantId, reportCode);
  const hashes = await Promise.all(session.baseline.map(async entry => {
    try { const bytes = await regularRead(path.join(root, entry.path)); return { path: entry.path, sha256: sha(bytes), unchanged: sha(bytes) === entry.sha256 }; }
    catch { return { path: entry.path, sha256: null, unchanged: false }; }
  }));
  const dirty = await getWorkspaceStatus(session.tenantId, reportCode, "working");
  let uploadedBlobs = 0;
  try { uploadedBlobs = (await fs.readdir(path.join(directory(session.tenantId, reportCode, id), "blobs"))).length; } catch { /* no uploads */ }
  return { baseCommitHash: session.baseCommitHash, currentCommitHash: current, files: hashes, uploadedBlobs, uploadManifest: [], cloudDraftUnchanged: current === session.baseCommitHash && dirty.length === 0 && hashes.every(f => f.unchanged), saved: false, published: false };
}
