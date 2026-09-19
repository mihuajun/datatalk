import fs from "node:fs/promises";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";

import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { fromReportPageDocument } from "@/lib/report-types";
import type { ReportCenterData, ReportDefinition, ReportFolder, ReportItem, ReportStatus } from "@/lib/report-types";
import { reportFilterManifestFromDefinition, type ReportFilterManifest } from "@/lib/report-filters";
import type { WebFileMap } from "@/lib/report-web";
import { getDbPool, withDatabaseReadRetry } from "@/lib/server/mysql";
import { getWorkspaceHead, getWorkspaceStatus } from "@/lib/server/local-git";
import { generatePublicLinkPassword, hashPublicLinkPassword, hasPublicLinkAccess } from "@/lib/server/public-link-security";
import { readReportFilterManifest } from "@/lib/server/report-filter-runtime";
import { getReportWorkingPath, getReportWorkspacePath, initializeReportWorkspace, resolveReportSourcePath } from "@/lib/server/report-workspace";

type ReportFolderRow = RowDataPacket & {
  id: number;
  parent_id: number | null;
  name: string;
  is_default: number;
  report_count?: number;
};

type ReportRow = RowDataPacket & {
  tenant_id: number;
  id: number;
  folder_id: number;
  code: string;
  name: string;
  owner_id: number | null;
  owner_name: string;
  status: string;
  views: number;
  definition_json?: string | null;
  updated_at: string | Date;
  working_commit_hash: string | null;
  current_working_revision: number;
  current_release_version: number | null;
  published_commit_hash?: string | null;
  release_status: string;
  public_link_enabled: number;
  deleted_at?: string | Date | null;
  deleted_by?: number | null;
};

type PublicLinkRow = RowDataPacket & {
  id: number;
  tenant_id: number;
  report_code: string;
  short_code: string;
  enabled: number;
  password_enabled: number;
  password: string | null;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
};

const FOLDER_FIELDS = "id, parent_id, name, is_default";
const REPORT_FIELDS = "tenant_id, id, folder_id, code, name, owner_id, owner_name, status, views, definition_json, updated_at, working_commit_hash, current_working_revision, current_release_version, release_status, public_link_enabled, deleted_at, deleted_by";
const ACTIVE_REPORT_WHERE = "deleted_at IS NULL";
const PUBLIC_LINK_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const PUBLIC_LINK_LENGTH = 8;

function generateReportCode() {
  return randomUUID().replaceAll("-", "").toLowerCase();
}

function generatePublicLinkCode() {
  return Array.from({ length: PUBLIC_LINK_LENGTH }, () => PUBLIC_LINK_ALPHABET[randomInt(0, PUBLIC_LINK_ALPHABET.length)]).join("");
}

export type PublicLinkSettings = {
  publicLinkCode: string;
  publicLinkPassword: string | null;
  publicLinkPasswordEnabled: boolean;
  publicLinkExpiresAt: string | null;
};

function formatPublicLinkDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePublicLink(row: PublicLinkRow): PublicLinkSettings {
  return {
    publicLinkCode: row.short_code,
    publicLinkPassword: row.password || null,
    publicLinkPasswordEnabled: Number(row.password_enabled) === 1,
    publicLinkExpiresAt: formatPublicLinkDate(row.expires_at),
  };
}

function isDuplicateEntry(error: unknown) {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

type ReportAiConversationRow = RowDataPacket & {
  conversation_id: string;
  title: string;
  created_at: string | Date;
  updated_at: string | Date;
  dsh_session_id?: string | null;
};

export type ReportAiConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type ReportAiConversationRecord = {
  conversation: ReportAiConversation;
  dshSessionId: string | null;
};

export type ReportAiMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

function normalizeAiConversation(row: ReportAiConversationRow): ReportAiConversation {
  return {
    id: row.conversation_id,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    messageCount: 0,
  };
}

export async function listReportAiConversationRecords(tenantId: number, reportCode: string): Promise<ReportAiConversationRecord[]> {
  const [rows] = await withDatabaseReadRetry(() => getDbPool().query<ReportAiConversationRow[]>(
    `SELECT c.conversation_id, c.title, c.created_at, c.updated_at, c.dsh_session_id
       FROM report_ai_conversation c
      WHERE c.tenant_id = ? AND c.report_code = ?
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT 20`,
    [tenantId, reportCode],
  ));
  return rows.map((row) => ({
    conversation: normalizeAiConversation(row),
    dshSessionId: row.dsh_session_id || null,
  }));
}

export async function listReportAiConversations(tenantId: number, reportCode: string) {
  const records = await listReportAiConversationRecords(tenantId, reportCode);
  return records.map(({ conversation }) => conversation);
}

export async function getReportAiConversation(tenantId: number, reportCode: string, conversationId: string) {
  const [conversationRows] = await withDatabaseReadRetry(() => getDbPool().query<ReportAiConversationRow[]>(
    `SELECT c.conversation_id, c.title, c.created_at, c.updated_at, c.dsh_session_id
       FROM report_ai_conversation c
      WHERE c.tenant_id = ? AND c.report_code = ? AND c.conversation_id = ?
      LIMIT 1`,
    [tenantId, reportCode, conversationId],
  ));
  const conversation = conversationRows[0];
  if (!conversation) return null;
  return { conversation: normalizeAiConversation(conversation), dshSessionId: conversation.dsh_session_id || null };
}

export async function updateReportAiConversationTitle(input: {
  tenantId: number;
  reportCode: string;
  conversationId: string;
  title: string;
}) {
  const title = input.title.trim().slice(0, 160);
  if (!title) return false;

  const [result] = await getDbPool().execute<ResultSetHeader>(
    `UPDATE report_ai_conversation
        SET title=?
      WHERE tenant_id=? AND report_code=? AND conversation_id=?`,
    [title, input.tenantId, input.reportCode, input.conversationId],
  );
  return result.affectedRows > 0;
}

export async function saveReportAiConversationIndex(input: {
  tenantId: number;
  reportCode: string;
  userId: number;
  conversationId?: string;
  dshSessionId?: string | null;
  title: string;
}) {
  const pool = getDbPool();
  const conversationId = input.conversationId?.trim() || randomUUID();
  const title = input.title.trim().slice(0, 160) || "报表对话";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingRows] = await connection.query<Array<RowDataPacket & { title: string }>>(
      "SELECT title FROM report_ai_conversation WHERE tenant_id=? AND report_code=? AND conversation_id=? LIMIT 1 FOR UPDATE",
      [input.tenantId, input.reportCode, conversationId],
    );
    const existing = existingRows[0];
    if (!existing) {
      await connection.execute(
        "INSERT INTO report_ai_conversation (tenant_id, report_code, conversation_id, title, created_by, dsh_session_id) VALUES (?, ?, ?, ?, ?, ?)",
        [input.tenantId, input.reportCode, conversationId, title, input.userId, input.dshSessionId || null],
      );
    } else if (input.dshSessionId) {
      await connection.execute(
        "UPDATE report_ai_conversation SET dsh_session_id=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND report_code=? AND conversation_id=?",
        [input.dshSessionId, input.tenantId, input.reportCode, conversationId],
      );
    }
    await connection.execute(
      "UPDATE report_ai_conversation SET updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND report_code=? AND conversation_id=?",
      [input.tenantId, input.reportCode, conversationId],
    );
    await connection.commit();
    return { id: conversationId, title: existing?.title || title, updatedAt: new Date().toISOString() };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function formatUpdatedAt(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (startOfDate === startOfToday) {
    return `今天 ${time}`;
  }

  if (startOfDate === startOfToday - oneDay) {
    return `昨天 ${time}`;
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function normalizeStatus(value: string): ReportStatus {
  return value === "已发布" ? "已发布" : "草稿";
}

function normalizeReport(row: ReportRow): ReportItem {
  return {
    id: String(row.id),
    code: row.code,
    name: row.name,
    owner: row.owner_name,
    ownerId: row.owner_id == null ? null : String(row.owner_id),
    updatedAt: formatUpdatedAt(row.updated_at),
    views: Number(row.views || 0),
    status: normalizeStatus(row.status),
    publicLinkEnabled: Number(row.public_link_enabled) === 1,
  };
}

function normalizeFolder(row: ReportFolderRow): ReportFolder {
  return {
    id: String(row.id),
    parentId: row.parent_id == null ? null : String(row.parent_id),
    name: row.name,
    isDefault: Number(row.is_default) === 1,
    reportCount: 0,
    children: [],
    reports: [],
  };
}

function buildFolderTree(folderRows: ReportFolderRow[], reportRows: ReportRow[]) {
  const folders = new Map<string, ReportFolder>();
  const roots: ReportFolder[] = [];

  for (const row of folderRows) {
    const folder = normalizeFolder(row);
    folders.set(folder.id, folder);
  }

  for (const row of folderRows) {
    const folder = folders.get(String(row.id));
    const parent = row.parent_id == null ? null : folders.get(String(row.parent_id));
    if (!folder) continue;

    if (parent) {
      parent.children.push(folder);
    } else {
      roots.push(folder);
    }
  }

  for (const row of reportRows) {
    const folder = folders.get(String(row.folder_id));
    if (!folder) continue;
    folder.reports.push(normalizeReport(row));
    folder.reportCount += 1;
  }

  return roots;
}

export async function ensureDefaultReportFolder(tenantId: number) {
  const pool = getDbPool();
  const [defaultFolders] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM tenant_report_folder WHERE tenant_id = ? AND is_default = 1 LIMIT 1",
    [tenantId],
  );
  if (defaultFolders[0]) {
    return Number(defaultFolders[0].id);
  }

  const [namedFolders] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM tenant_report_folder WHERE tenant_id = ? AND parent_id IS NULL AND name = ? LIMIT 1",
    [tenantId, "默认目录"],
  );
  if (namedFolders[0]) {
    const folderId = Number(namedFolders[0].id);
    await pool.execute(
      "UPDATE tenant_report_folder SET is_default = 1, sort_order = LEAST(sort_order, -1) WHERE tenant_id = ? AND id = ?",
      [tenantId, folderId],
    );
    return folderId;
  }

  const [result] = await pool.execute(
    "INSERT INTO tenant_report_folder (tenant_id, parent_id, name, is_default, sort_order, created_by) VALUES (?, NULL, ?, 1, -1, NULL)",
    [tenantId, "默认目录"],
  );
  return Number((result as { insertId: number }).insertId);
}

export async function listReports(tenantId: number): Promise<ReportCenterData> {
  await ensureDefaultReportFolder(tenantId);
  const pool = getDbPool();
  const [folderRows] = await pool.query<ReportFolderRow[]>(
    `SELECT ${FOLDER_FIELDS} FROM tenant_report_folder WHERE tenant_id = ? ORDER BY parent_id IS NOT NULL ASC, sort_order ASC, id ASC`,
    [tenantId],
  );
  const [reportRows] = await pool.query<ReportRow[]>(
    `SELECT ${REPORT_FIELDS} FROM tenant_report WHERE tenant_id = ? AND ${ACTIVE_REPORT_WHERE} ORDER BY folder_id ASC, updated_at DESC, id ASC`,
    [tenantId],
  );
  const folders = buildFolderTree(folderRows, reportRows);

  return {
    folders,
    summary: {
      folderCount: folderRows.length,
      reportCount: reportRows.length,
      publishedCount: reportRows.filter((row) => row.status === "已发布").length,
      draftCount: reportRows.filter((row) => row.status !== "已发布").length,
    },
  };
}

export async function createReport(input: {
  tenantId: number;
  folderId: number;
  name: string;
  ownerId: number | null;
  ownerName: string;
}) {
  const pool = getDbPool();
  const [folders] = await pool.query<ReportFolderRow[]>(
    `SELECT ${FOLDER_FIELDS} FROM tenant_report_folder WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [input.tenantId, input.folderId],
  );
  if (!folders[0]) {
    return null;
  }

  const code = generateReportCode();
  const [result] = await pool.execute(
    `INSERT INTO tenant_report
      (tenant_id, folder_id, code, name, owner_id, owner_name, status, views)
      VALUES (?, ?, ?, ?, ?, ?, '草稿', 0)`,
    [input.tenantId, input.folderId, code, input.name, input.ownerId, input.ownerName],
  );
  const reportId = Number((result as { insertId: number }).insertId);
  await initializeReportWorkspace(input.tenantId, code, { title: input.name, dateRange: "", filters: [], widgets: [] });
  const [reports] = await pool.query<ReportRow[]>(
    `SELECT ${REPORT_FIELDS} FROM tenant_report WHERE tenant_id = ? AND id = ? AND ${ACTIVE_REPORT_WHERE} LIMIT 1`,
    [input.tenantId, reportId],
  );
  return reports[0] ? normalizeReport(reports[0]) : null;
}

function parseReportDefinition(value: unknown): ReportDefinition | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as ReportDefinition;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function makeEmptyReportDefinition(title: string): ReportDefinition {
  return { title, subTitle: "", dateRange: "", filters: [], widgets: [] };
}

export type ReportWorkspaceSnapshot = {
  webFiles: WebFileMap;
  filterManifest: ReportFilterManifest | null;
  fingerprint: string;
};

const WEB_IMAGE_MEDIA_TYPES: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};
const MAX_INLINE_WEB_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_INLINE_WEB_ASSETS_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_INLINE_WEB_ASSETS = 30;

function referencedWebImagePaths(files: WebFileMap) {
  const source = `${files["page.html"] || ""}\n${files["styles.css"] || ""}`;
  const matches = source.matchAll(/(?:\.\/)?(assets\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:avif|gif|jpe?g|png|svg|webp))/gi);
  return [...new Set(Array.from(matches, (match) => match[1]))]
    .filter((relativePath) => !relativePath.split("/").some((segment) => segment === "." || segment === ".."))
    .slice(0, MAX_INLINE_WEB_ASSETS);
}

async function readReferencedWebImageAssets(root: string, files: WebFileMap) {
  const assets: Record<string, string> = {};
  let totalBytes = 0;
  const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
  for (const relativePath of referencedWebImagePaths(files)) {
    const extension = relativePath.split(".").at(-1)?.toLowerCase() || "";
    const mediaType = WEB_IMAGE_MEDIA_TYPES[extension];
    if (!mediaType) continue;
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${path.resolve(root)}${path.sep}`)) continue;
    try {
      const realAssetPath = await fs.realpath(absolutePath);
      if (!realAssetPath.startsWith(`${realRoot}${path.sep}`)) continue;
      const stat = await fs.stat(realAssetPath);
      if (!stat.isFile() || stat.size > MAX_INLINE_WEB_ASSET_BYTES || totalBytes + stat.size > MAX_INLINE_WEB_ASSETS_TOTAL_BYTES) continue;
      const content = await fs.readFile(realAssetPath);
      totalBytes += content.byteLength;
      assets[relativePath] = `data:${mediaType};base64,${content.toString("base64")}`;
    } catch {
      // A missing or unreadable referenced asset remains visible to the preview as a broken image.
    }
  }
  return assets;
}

async function readWebFiles(root: string) {
  const webFiles: WebFileMap = {};
  for (const name of ["page.html", "styles.css", "app.js"] as const) {
    try { webFiles[name] = await fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ root, name), "utf8"); } catch { /* optional workspace file */ }
  }
  const assets = await readReferencedWebImageAssets(root, webFiles);
  if (Object.keys(assets).length) webFiles.assets = assets;
  return webFiles;
}

async function findLatestWorkspaceMtime(root: string, relativeDirectory = ""): Promise<bigint> {
  let entries;
  try {
    entries = await fs.readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  } catch {
    return 0n;
  }

  let latestMtimeNs = 0n;
  for (const entry of entries) {
    if (entry.name === "runtime") continue;
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolutePath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      const nestedMtimeNs = await findLatestWorkspaceMtime(root, relativePath);
      if (nestedMtimeNs > latestMtimeNs) latestMtimeNs = nestedMtimeNs;
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const stat = await fs.stat(absolutePath, { bigint: true });
      if (stat.mtimeNs > latestMtimeNs) latestMtimeNs = stat.mtimeNs;
    } catch {
      // Files can disappear between readdir and stat; the next poll will reconcile them.
    }
  }
  return latestMtimeNs;
}

export async function getReportWorkspaceFingerprint(tenantId: number, reportCode: string) {
  return (await findLatestWorkspaceMtime(getReportWorkingPath(tenantId, reportCode))).toString();
}

export async function readReportWorkspaceSnapshot(tenantId: number, reportCode: string, fingerprint?: string, fallbackFilters?: unknown): Promise<ReportWorkspaceSnapshot> {
  const webFiles = await readWebFiles(getReportWorkingPath(tenantId, reportCode));
  return {
    filterManifest: await readReportFilterManifest(tenantId, reportCode, "working", undefined, fallbackFilters),
    fingerprint: fingerprint || await getReportWorkspaceFingerprint(tenantId, reportCode),
    webFiles,
  };
}

async function getPublishedCommitHash(tenantId: number, reportCode: string, version: number | null) {
  if (version == null) return null;
  const [rows] = await getDbPool().query<Array<RowDataPacket & { source_commit_hash: string }>>(
    "SELECT source_commit_hash FROM report_release WHERE tenant_id=? AND report_code=? AND version=? AND status='published' ORDER BY id DESC LIMIT 1",
    [tenantId, reportCode, version],
  );
  return rows[0]?.source_commit_hash || null;
}

async function readPublicReleaseSnapshot(tenantId: number, reportCode: string, version: number, reportName: string) {
  const releasePath = path.join(getReportWorkspacePath(tenantId, reportCode), "releases", `v${version}`);
  const files = await readWebFiles(releasePath);

  if (!files["page.html"]) {
    try {
      const [publishedCommitHash, workspaceHead, workspaceStatus] = await Promise.all([
        getPublishedCommitHash(tenantId, reportCode, version),
        getWorkspaceHead(tenantId, reportCode),
        getWorkspaceStatus(tenantId, reportCode, "working"),
      ]);
      if (publishedCommitHash && workspaceHead === publishedCommitHash && workspaceStatus.length === 0) {
        const workspace = await readReportWorkspaceSnapshot(tenantId, reportCode);
        return {
          definition: makeEmptyReportDefinition(reportName),
          filterManifest: workspace.filterManifest,
          webFiles: workspace.webFiles,
        };
      }
    } catch {
      // A missing release snapshot stays unavailable unless its working tree is provably identical.
    }
  }

  const definition: ReportDefinition | null = makeEmptyReportDefinition(reportName);

  return {
    definition,
    filterManifest: await readReportFilterManifest(tenantId, reportCode, "release", version),
    webFiles: {
      "page.html": files["page.html"],
      "styles.css": files["styles.css"],
      "app.js": files["app.js"],
      ...(files.assets ? { assets: files.assets } : {}),
    } satisfies WebFileMap,
  };
}

export async function getReportDetail(tenantId: number, reportId: number) {
  const [rows] = await withDatabaseReadRetry(() => getDbPool().query<ReportRow[]>(
    `SELECT ${REPORT_FIELDS} FROM tenant_report WHERE tenant_id = ? AND id = ? AND ${ACTIVE_REPORT_WHERE} LIMIT 1`,
    [tenantId, reportId],
  ));
  const row = rows[0];
  if (!row) return null;

  let definition: ReportDefinition | null = null;
    let workspace: ReportWorkspaceSnapshot = { webFiles: {}, filterManifest: null, fingerprint: "" };
  try {
    await initializeReportWorkspace(tenantId, row.code, parseReportDefinition(row.definition_json));
    definition = parseReportDefinition(row.definition_json) || makeEmptyReportDefinition(row.name);
    workspace = await readReportWorkspaceSnapshot(tenantId, row.code, undefined, reportFilterManifestFromDefinition(definition));
  } catch {
    // Workspace initialization failures are surfaced as an unavailable report.
  }
  return {
    report: normalizeReport(row),
    definition,
    filterManifest: workspace.filterManifest,
    webFiles: workspace.webFiles,
    workspaceFingerprint: workspace.fingerprint,
    workingCommitHash: await getWorkspaceHead(tenantId, row.code),
    publishedCommitHash: await getPublishedCommitHash(tenantId, row.code, row.current_release_version),
  };
}

export async function getReportDetailByCode(tenantId: number, reportCode: string) {
  const [rows] = await withDatabaseReadRetry(() => getDbPool().query<ReportRow[]>(
    `SELECT ${REPORT_FIELDS} FROM tenant_report WHERE tenant_id = ? AND code = ? AND ${ACTIVE_REPORT_WHERE} LIMIT 1`,
    [tenantId, reportCode],
  ));
  const row = rows[0];
  if (!row) return null;

  let definition: ReportDefinition | null = null;
    let workspace: ReportWorkspaceSnapshot = { webFiles: {}, filterManifest: null, fingerprint: "" };
  try {
    await initializeReportWorkspace(tenantId, reportCode, parseReportDefinition(row.definition_json));
    definition = parseReportDefinition(row.definition_json) || makeEmptyReportDefinition(row.name);
    workspace = await readReportWorkspaceSnapshot(tenantId, reportCode, undefined, reportFilterManifestFromDefinition(definition));
  } catch {
    // Workspace initialization failures are surfaced as an unavailable report.
  }
  return {
    report: normalizeReport(row),
    definition,
    filterManifest: workspace.filterManifest,
    webFiles: workspace.webFiles,
    workspaceFingerprint: workspace.fingerprint,
    workingCommitHash: await getWorkspaceHead(tenantId, reportCode),
    publishedCommitHash: await getPublishedCommitHash(tenantId, row.code, row.current_release_version),
  };
}

export async function getReportReleaseDetailByCode(tenantId: number, reportCode: string, requestedReleaseVersion?: number) {
  const [rows] = await withDatabaseReadRetry(() => getDbPool().query<ReportRow[]>(
    `SELECT ${REPORT_FIELDS} FROM tenant_report WHERE tenant_id = ? AND code = ? AND ${ACTIVE_REPORT_WHERE} LIMIT 1`,
    [tenantId, reportCode],
  ));
  const row = rows[0];
  const releaseVersion = requestedReleaseVersion ?? row?.current_release_version;
  if (!row || releaseVersion == null) return null;

  if (requestedReleaseVersion != null) {
    const [releaseRows] = await withDatabaseReadRetry(() => getDbPool().query<Array<RowDataPacket & { version: number }>>(
      `SELECT version
         FROM report_release
        WHERE tenant_id = ? AND report_code = ? AND version = ? AND status = 'published'
        LIMIT 1`,
      [tenantId, reportCode, requestedReleaseVersion],
    ));
    if (!releaseRows[0]) return null;
  }

  const snapshot = await readPublicReleaseSnapshot(tenantId, reportCode, releaseVersion, row.name);
  return {
    report: normalizeReport(row),
    ...snapshot,
    releaseVersion,
  };
}

async function createPublicLink(connection: PoolConnection, input: {
  tenantId: number;
  reportCode: string;
  userId: number;
  passwordEnabled?: boolean;
  expiresAt?: Date | null;
}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const shortCode = generatePublicLinkCode();
    const password = generatePublicLinkPassword();
    try {
      await connection.execute(
        `INSERT INTO report_public_link
          (tenant_id, report_code, short_code, enabled, password_enabled, password, expires_at, created_by)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
        [input.tenantId, input.reportCode, shortCode, input.passwordEnabled === true ? 1 : 0, password, input.expiresAt || null, input.userId],
      );
      return {
        publicLinkCode: shortCode,
        publicLinkPassword: password,
        publicLinkPasswordEnabled: input.passwordEnabled === true,
        publicLinkExpiresAt: formatPublicLinkDate(input.expiresAt),
      } satisfies PublicLinkSettings;
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
    }
  }

  throw new Error("PUBLIC_LINK_CODE_GENERATION_FAILED");
}

async function getCurrentPublicLinkRow(connection: PoolConnection, tenantId: number, reportCode: string) {
  const [rows] = await connection.query<PublicLinkRow[]>(
    `SELECT id, tenant_id, report_code, short_code, enabled, password_enabled, password, expires_at, revoked_at
       FROM report_public_link
      WHERE tenant_id = ? AND report_code = ? AND enabled = 1 AND revoked_at IS NULL
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE`,
    [tenantId, reportCode],
  );
  return rows[0];
}

export async function getCurrentReportPublicLink(tenantId: number, reportCode: string) {
  const [rows] = await getDbPool().query<PublicLinkRow[]>(
    `SELECT id, tenant_id, report_code, short_code, enabled, password_enabled, password, expires_at, revoked_at
       FROM report_public_link
      WHERE tenant_id = ? AND report_code = ? AND enabled = 1 AND revoked_at IS NULL
      ORDER BY id DESC
      LIMIT 1`,
    [tenantId, reportCode],
  );
  return rows[0] ? { id: Number(rows[0].id), ...normalizePublicLink(rows[0]) } : null;
}

export async function getCurrentReportPublicLinkCode(tenantId: number, reportCode: string) {
  return (await getCurrentReportPublicLink(tenantId, reportCode))?.publicLinkCode || null;
}

export async function updateReportPublicLink(input: {
  tenantId: number;
  reportCode: string;
  userId: number;
  enabled: boolean;
  rotate?: boolean;
  passwordEnabled?: boolean;
  resetPassword?: boolean;
  expiresAt?: Date | null;
}) {
  const pool = getDbPool();
  const connection = await pool.getConnection();
  let publicLink: PublicLinkSettings | null = null;
  let report: ReportRow | undefined;

  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<ReportRow[]>(
      `SELECT ${REPORT_FIELDS}
         FROM tenant_report
        WHERE tenant_id = ? AND code = ? AND ${ACTIVE_REPORT_WHERE}
        LIMIT 1
        FOR UPDATE`,
      [input.tenantId, input.reportCode],
    );
    report = rows[0];
    if (!report) {
      await connection.rollback();
      return null;
    }

    if (input.enabled) {
      const currentLink = await getCurrentPublicLinkRow(connection, input.tenantId, input.reportCode);
      if (currentLink && !input.rotate) {
        const password = input.resetPassword || !currentLink.password ? generatePublicLinkPassword() : currentLink.password;
        const passwordEnabled = input.passwordEnabled ?? Number(currentLink.password_enabled) === 1;
        const expiresAt = input.expiresAt === undefined
          ? (currentLink.expires_at ? new Date(currentLink.expires_at) : null)
          : input.expiresAt;

        if (input.resetPassword || !currentLink.password || input.passwordEnabled !== undefined || input.expiresAt !== undefined) {
          await connection.execute(
            `UPDATE report_public_link
                SET password_enabled = ?, password = ?, expires_at = ?
              WHERE id = ?`,
            [passwordEnabled ? 1 : 0, password, expiresAt, currentLink.id],
          );
        }
        publicLink = {
          publicLinkCode: currentLink.short_code,
          publicLinkPassword: password,
          publicLinkPasswordEnabled: passwordEnabled,
          publicLinkExpiresAt: formatPublicLinkDate(expiresAt),
        };
      } else {
        await connection.execute(
          `UPDATE report_public_link
              SET enabled = 0, revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
            WHERE tenant_id = ? AND report_code = ? AND enabled = 1 AND revoked_at IS NULL`,
          [input.tenantId, input.reportCode],
        );
        publicLink = await createPublicLink(connection, {
          tenantId: input.tenantId,
          reportCode: input.reportCode,
          userId: input.userId,
          passwordEnabled: input.passwordEnabled ?? (currentLink ? Number(currentLink.password_enabled) === 1 : false),
          expiresAt: input.expiresAt === undefined
            ? (currentLink?.expires_at ? new Date(currentLink.expires_at) : null)
            : input.expiresAt,
        });
      }
    } else {
      await connection.execute(
        `UPDATE report_public_link
            SET enabled = 0, revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
          WHERE tenant_id = ? AND report_code = ? AND enabled = 1 AND revoked_at IS NULL`,
        [input.tenantId, input.reportCode],
      );
    }

    await connection.execute(
      "UPDATE tenant_report SET public_link_enabled = ? WHERE tenant_id = ? AND code = ?",
      [input.enabled ? 1 : 0, input.tenantId, input.reportCode],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    report: normalizeReport({ ...report, public_link_enabled: input.enabled ? 1 : 0 }),
    publicLinkCode: publicLink?.publicLinkCode || null,
    publicLinkPassword: publicLink?.publicLinkPassword || null,
    publicLinkPasswordEnabled: publicLink?.publicLinkPasswordEnabled ?? false,
    publicLinkExpiresAt: publicLink?.publicLinkExpiresAt || null,
  };
}

type PublicReportLinkRow = ReportRow & {
  public_link_id: number;
  public_link_short_code: string;
  public_link_password_enabled: number;
  public_link_password: string | null;
  public_link_expires_at: string | Date | null;
};

export async function getPublicReportDetailByLinkCode(shortCode: string) {
  const pool = getDbPool();
  const [tokenRows] = await pool.query<PublicReportLinkRow[]>(
    `SELECT r.*, l.id AS public_link_id, l.short_code AS public_link_short_code,
            l.password_enabled AS public_link_password_enabled, l.password AS public_link_password,
            l.expires_at AS public_link_expires_at
       FROM report_public_link l
       INNER JOIN tenant_report r ON r.tenant_id = l.tenant_id AND r.code = l.report_code
      WHERE l.short_code = ?
        AND l.enabled = 1
        AND l.revoked_at IS NULL
        AND (l.expires_at IS NULL OR l.expires_at > CURRENT_TIMESTAMP)
        AND r.deleted_at IS NULL
        AND r.public_link_enabled = 1
        AND r.current_release_version IS NOT NULL
      LIMIT 1`,
    [shortCode],
  );
  const row: PublicReportLinkRow | undefined = tokenRows[0];
  if (!row || row.current_release_version == null) return null;

  const passwordProtected = Number(row.public_link_password_enabled) === 1 && Boolean(row.public_link_password);
  if (passwordProtected && !(await hasPublicLinkAccess(shortCode, {
    linkId: Number(row.public_link_id),
    passwordHash: hashPublicLinkPassword(row.public_link_password || ""),
  }))) {
    return { requiresPassword: true as const };
  }

  const snapshot = await readPublicReleaseSnapshot(row.tenant_id, row.code, row.current_release_version, row.name);
  return { report: normalizeReport(row), ...snapshot };
}

export type PublicLinkVerificationData = {
  id: number;
  shortCode: string;
  passwordEnabled: boolean;
  password: string | null;
  expiresAt: string | Date | null;
};

export async function getPublicLinkVerificationData(shortCode: string): Promise<PublicLinkVerificationData | null> {
  const [rows] = await getDbPool().query<Array<RowDataPacket & {
    id: number;
    short_code: string;
    password_enabled: number;
    password: string | null;
    expires_at: string | Date | null;
  }>>(
    `SELECT l.id, l.short_code, l.password_enabled, l.password, l.expires_at
       FROM report_public_link l
       INNER JOIN tenant_report r ON r.tenant_id = l.tenant_id AND r.code = l.report_code
      WHERE l.short_code = ?
        AND l.enabled = 1
        AND l.revoked_at IS NULL
        AND (l.expires_at IS NULL OR l.expires_at > CURRENT_TIMESTAMP)
        AND r.deleted_at IS NULL
        AND r.public_link_enabled = 1
        AND r.current_release_version IS NOT NULL
      LIMIT 1`,
    [shortCode],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    shortCode: row.short_code,
    passwordEnabled: Number(row.password_enabled) === 1,
    password: row.password || null,
    expiresAt: row.expires_at,
  };
}

export async function updateReport(input: {
  tenantId: number;
  reportId: number;
  name: string;
  definition: ReportDefinition;
  status: ReportStatus;
}) {
  const result = await getReportDetail(input.tenantId, input.reportId);
  if (!result) return null;

  await getDbPool().execute(
    `UPDATE tenant_report
      SET name = ?, status = ?
      WHERE tenant_id = ? AND id = ?`,
    [input.name, input.status, input.tenantId, input.reportId],
  );

  return getReportDetail(input.tenantId, input.reportId);
}

export async function updateReportByCode(input: {
  tenantId: number;
  reportCode: string;
  name: string;
  definition: ReportDefinition;
  status: ReportStatus;
}) {
  const result = await getReportDetailByCode(input.tenantId, input.reportCode);
  if (!result) return null;

  await getDbPool().execute(
    `UPDATE tenant_report
      SET name = ?, status = ?
      WHERE tenant_id = ? AND code = ? AND ${ACTIVE_REPORT_WHERE}`,
    [input.name, input.status, input.tenantId, input.reportCode],
  );

  return getReportDetailByCode(input.tenantId, input.reportCode);
}

export async function deleteReportByCode(input: {
  tenantId: number;
  reportCode: string;
  userId: number | null;
}) {
  const pool = getDbPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<ReportRow[]>(
      `SELECT ${REPORT_FIELDS}
         FROM tenant_report
        WHERE tenant_id = ? AND code = ? AND ${ACTIVE_REPORT_WHERE}
        LIMIT 1
        FOR UPDATE`,
      [input.tenantId, input.reportCode],
    );
    const report = rows[0];
    if (!report) {
      await connection.rollback();
      return null;
    }

    await connection.execute(
      `UPDATE tenant_report
          SET deleted_at = CURRENT_TIMESTAMP,
              deleted_by = ?,
              public_link_enabled = 0
        WHERE tenant_id = ? AND code = ? AND ${ACTIVE_REPORT_WHERE}`,
      [input.userId, input.tenantId, input.reportCode],
    );
    await connection.execute(
      `UPDATE report_public_link
          SET enabled = 0,
              revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
        WHERE tenant_id = ? AND report_code = ? AND enabled = 1 AND revoked_at IS NULL`,
      [input.tenantId, input.reportCode],
    );
    await connection.commit();

    return {
      id: String(report.id),
      code: report.code,
      name: report.name,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getReportFolder(tenantId: number, folderId: number) {
  const [rows] = await getDbPool().query<ReportFolderRow[]>(
    `SELECT ${FOLDER_FIELDS} FROM tenant_report_folder WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [tenantId, folderId],
  );
  return rows[0] ? normalizeFolder(rows[0]) : null;
}

export async function createReportFolder(input: {
  tenantId: number;
  parentId: number | null;
  name: string;
  createdBy: number | null;
}) {
  const pool = getDbPool();

  const [existingFolders] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM tenant_report_folder WHERE tenant_id = ? AND parent_id <=> ? AND name = ? LIMIT 1",
    [input.tenantId, input.parentId, input.name],
  );
  if (existingFolders[0]) {
    const duplicateError = new Error("REPORT_FOLDER_DUPLICATE");
    Object.assign(duplicateError, { code: "REPORT_FOLDER_DUPLICATE" });
    throw duplicateError;
  }

  if (input.parentId !== null) {
    const [parents] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM tenant_report_folder WHERE tenant_id = ? AND id = ? LIMIT 1",
      [input.tenantId, input.parentId],
    );
    if (!parents[0]) {
      return null;
    }
  }

  const [result] = await pool.execute(
    "INSERT INTO tenant_report_folder (tenant_id, parent_id, name, is_default, sort_order, created_by) VALUES (?, ?, ?, 0, 0, ?)",
    [input.tenantId, input.parentId, input.name, input.createdBy],
  );

  return getReportFolder(input.tenantId, Number((result as { insertId: number }).insertId));
}

function reportFolderError(code: string) {
  const error = new Error(code);
  Object.assign(error, { code });
  return error;
}

export async function renameReportFolder(input: {
  tenantId: number;
  folderId: number;
  name: string;
}) {
  const pool = getDbPool();
  const [folders] = await pool.query<ReportFolderRow[]>(
    `SELECT ${FOLDER_FIELDS} FROM tenant_report_folder WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [input.tenantId, input.folderId],
  );
  const folder = folders[0];
  if (!folder) {
    return null;
  }

  const [duplicates] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM tenant_report_folder WHERE tenant_id = ? AND parent_id <=> ? AND name = ? AND id <> ? LIMIT 1",
    [input.tenantId, folder.parent_id, input.name, input.folderId],
  );
  if (duplicates[0]) {
    throw reportFolderError("REPORT_FOLDER_DUPLICATE");
  }

  await pool.execute(
    "UPDATE tenant_report_folder SET name = ? WHERE tenant_id = ? AND id = ?",
    [input.name, input.tenantId, input.folderId],
  );

  return getReportFolder(input.tenantId, input.folderId);
}

export async function deleteReportFolder(tenantId: number, folderId: number) {
  const pool = getDbPool();
  const [folders] = await pool.query<ReportFolderRow[]>(
    `SELECT ${FOLDER_FIELDS} FROM tenant_report_folder WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [tenantId, folderId],
  );
  const folder = folders[0];
  if (!folder) {
    return null;
  }

  if (Number(folder.is_default) === 1) {
    throw reportFolderError("REPORT_FOLDER_DEFAULT");
  }

  const [children] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM tenant_report_folder WHERE tenant_id = ? AND parent_id = ? LIMIT 1",
    [tenantId, folderId],
  );
  if (children[0]) {
    throw reportFolderError("REPORT_FOLDER_HAS_CHILDREN");
  }

  const [reports] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM tenant_report WHERE tenant_id = ? AND folder_id = ? AND ${ACTIVE_REPORT_WHERE} LIMIT 1`,
    [tenantId, folderId],
  );
  if (reports[0]) {
    throw reportFolderError("REPORT_FOLDER_HAS_REPORTS");
  }

  await pool.execute(
    "DELETE FROM tenant_report_folder WHERE tenant_id = ? AND id = ? AND is_default = 0",
    [tenantId, folderId],
  );
  return true;
}
