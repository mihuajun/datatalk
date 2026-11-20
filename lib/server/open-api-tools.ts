import { prepareReportLocalPreview, inspectLocalPreviewBoundary, beginReportDevelopment, inspectReportDevelopment, developmentChangesForCommit, closeReportDevelopment, developmentFileSchema } from "@/lib/server/report-development";
import { STUDIO_WORKFLOW } from "@/lib/server/studio-mcp-contract";
import { searchMetricKnowledge, readReportMetricBindings, proposeMetricKnowledge } from "@/lib/server/report-metric-knowledge-service";
import { createPreviewLink } from "@/lib/server/studio-preview";
import { ensureConnectionSchema } from "@/lib/server/studio-connection-schema";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import type { RowDataPacket } from "mysql2/promise";
import type { ApiScope } from "@/lib/open-api-contract";
import { OpenApiError, requireApiScope, type ApiPrincipal } from "@/lib/server/open-api-auth";
import { getDbPool } from "@/lib/server/mysql";
import { createReport, listReports, getReportDetailByCode, getReportReleaseDetailByCode, getCurrentReportPublicLink, updateReportPublicLink } from "@/lib/server/report-repository";
import { listReportAgentDataSources, getReportAgentDataSourceSchema, previewReportAgentSql } from "@/lib/server/report-agent-tools";
import { applyReportChanges, publishReport, renameReport } from "@/lib/server/report-workspace-service";
import { copyPublishedResourceReport, copyWorkingReport } from "@/lib/server/report-copy-service";
import { getWorkspaceHead, getWorkspaceStatus, commitWorkspace } from "@/lib/server/local-git";
import { validateReportWorkspace, readReportWorkspaceFile } from "@/lib/server/report-schema";
import { getReportWorkingPath, isAllowedReportSourceFile } from "@/lib/server/report-workspace";
import { acquireReportEditLock, renewReportEditLock, releaseReportEditLock, isReportEditLockEnabled } from "@/lib/server/report-edit-lock";
import { isResourceCenterEnabled } from "@/lib/server/resource-center-config";
import { getPublishedPublicResourceById, getReportResourcePublicationState, listPublishedPublicResources, listResourceCategories, upsertResourceItem } from "@/lib/server/resource-repository";
import { buildReleaseThumbnailUrl, writeResourceThumbnailDataUrl } from "@/lib/server/report-release-thumbnail";
import type { ResourceAssetType } from "@/lib/resource-center-types";

const reportCode = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/);
const operationId = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);
const empty = {};
function validateResourceThumbnailDataUrl(value: string | undefined) {
  if (!value) return;
  if (value.length > 1_000_000) throw new OpenApiError("RESOURCE_THUMBNAIL_INVALID", 400, "资源缩略图不能超过 1,000,000 个字符");
  if (/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/i.test(value)) return;
  const match = value.match(/^data:image\/svg\+xml(;base64)?,([\s\S]+)$/i);
  if (!match) throw new OpenApiError("RESOURCE_THUMBNAIL_INVALID", 400, "仅支持 PNG 或 SVG 图片 data URL");
  let svg: string;
  try { svg = match[1] ? Buffer.from(match[2], "base64").toString("utf8") : decodeURIComponent(match[2]); }
  catch { throw new OpenApiError("RESOURCE_THUMBNAIL_INVALID", 400, "SVG 缩略图编码无效"); }
  if (!/<svg[\s>]/i.test(svg) || /<script\b|\bon[a-z]+\s*=|javascript:|<foreignObject\b|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:)/i.test(svg)) {
    throw new OpenApiError("RESOURCE_THUMBNAIL_INVALID", 400, "SVG 缩略图包含不允许的活动内容或外部资源");
  }
}
export const STUDIO_TOOLS = {
  search_metric_knowledge: { description: "按关键词和向量检索租户有效指标，返回固定版本、匹配原因和口径冲突。先检索再开发，降级或相似命中需人工确认。", scope: "reports:read", shape: { query: z.string().min(1).max(500), formulaHint: z.string().optional(), grainHint: z.string().optional(), timeFieldHint: z.string().optional(), dataSource: z.string().optional(), filters: z.array(z.string()).optional(), dimensions: z.array(z.string()).optional(), limit: z.number().int().min(1).max(20).optional() } },
  read_report_metric_bindings: { description: "读取报表实际引用的指标版本及历史定义，不把最新版本冒充报表口径。", scope: "reports:read", shape: { reportCode } },
  propose_metric_knowledge: { description: "通过 MCP 提交真实数据的纯文本 content 指标候选（明确模拟数据不调用本工具）（业务定义、表字段映射、公式、粒度、关联、过滤、单位、SQL 示例及未知项）；校验本指标 SQL，confirmed 只代表用户真实确认。必须通过 apply_report_changes 提交报表才能生效。将返回的 metricKey/version 写入 report.json.metricBindings 完整列表。", scope: "reports:write", shape: {
    reportCode, metricKey: z.string().max(100).optional(), baseVersion: z.number().int().min(0), name: z.string().min(1).max(160), aliases: z.array(z.string()).optional(),
    content: z.string().trim().min(1).max(60000), keywords: z.array(z.string().trim().min(1).max(160)).max(30).optional(),
    dataSource: z.string().min(1),
    confirmed: z.boolean(), validationSql: z.string().max(30000).optional(), validationParams: z.record(z.string(), z.unknown()).optional()
  } },
  get_studio_context: { description: "开始前调用，读取当前身份、权限、目录及 workflowContract。MCP 已内置完整开发流程，不需要 Skill；以返回的 workflowContract.version 确认当前服务版本。", scope: null, shape: empty },
  list_data_sources: { description: "列出当前租户的数据源名称和类型，不返回数据库凭据。", scope: "datasources:read", shape: empty },
  inspect_data_source_schema: { description: "读取已连接数据源的表和字段。先明确数据源再查询。", scope: "datasources:read", shape: { dataSourceRef: z.string().min(1).max(160), keyword: z.string().max(100).optional(), tables: z.array(z.string().max(200)).max(50).optional(), limit: z.number().int().min(1).max(50).optional() } },
  preview_query: { description: "执行受限的只读 SQL，最多返回 20 行和 256KB。先确认指标口径；不要杜撰数据。", scope: "data:query", shape: { dataSourceRef: z.string().min(1).max(160), sql: z.string().min(1).max(30000), params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))])).optional(), maxRows: z.number().int().min(1).max(20).optional() } },
  list_reports: { description: "列出当前租户的报表和目录。", scope: "reports:read", shape: empty },
  read_report: { description: "读取报表元数据、源码和 baseCommitHash。提交编辑前读取；files 可限定需要的文件。固定指标/单位/统计期；纯标题修改不要重写数据、运行时与样式。保存后读回比对需求。", scope: "reports:read", shape: { reportCode, files: z.array(z.string().max(200)).min(1).max(20).optional() } },
  create_report: { description: "使用 get_studio_context 返回的当前租户目录，从模板创建草稿并初始化版本。创建后 read_report 读取模板；无发布或分享副作用。operationId 为重试去重标识，重试必须沿用，不重复创建。", scope: "reports:write", shape: { name: z.string().trim().min(1).max(160), folderId: z.number().int().positive(), operationId } },
  rename_report: { description: "重命名当前租户中的报表列表/预览元数据名称，不修改报表源码或发布状态。整张报表改名需调用此工具；若还需同步页面标题，再读取当前版本并用 apply_report_changes 修改源码。两个操作不是原子操作，部分失败时读回并报告实际状态。", scope: "reports:write", shape: { reportCode, name: z.string().trim().min(1).max(160), operationId } },
  copy_report: { description: "将当前租户中的报表工作区复制为一个独立草稿；不复制运行时文件或发布状态。", scope: "reports:write", shape: { reportCode, name: z.string().trim().min(1).max(160).optional(), operationId } },
  list_public_resources: { description: "搜索 DataTalk 官网公开上架且有有效发布版本的报告和模板，只返回可复用的公开元数据，不返回源码。每项包含 detailUrl（官网说明/缩略图页）和 previewUrl（Studio 实时报表预览，若配置可用）；可把链接以 Markdown 链接展示，供用户点击评估。预览只读源发布版本，但会计入资源访问量。选中资源后可调用 copy_public_resource 复制为自己的草稿，再用 read_report 查看源码。", scope: "reports:read", shape: { assetType: z.enum(["report", "template"]).optional(), query: z.string().trim().max(200).optional(), category: z.string().trim().max(100).optional(), page: z.number().int().min(1).optional(), pageSize: z.number().int().min(1).max(50).optional(), sort: z.enum(["latest", "popular"]).optional() } },
  copy_public_resource: { description: "从 DataTalk 官网公开资源的已发布快照复制一份到当前租户默认报表目录，创建可二次开发的独立草稿。不复制发布状态，不改变源资源；只有用户明确选择并确认要复制的资源后才传 confirm=true。复制后用 read_report 读取新草稿源码。", scope: "reports:write", shape: { resourceId: z.number().int().positive(), operationId, confirm: z.literal(true), name: z.string().trim().min(1).max(160).optional() } },
  apply_report_changes: { description: "按 baseCommitHash 批量修改报表源码、校验并提交 Git 版本。只传实际变化文件；不发布、不重命名报表元数据，改列表/预览名称需另调 rename_report。结构校验通过不代表需求比对或视觉验收通过。可传 expectedReportName 防止并发重命名后覆盖旧标题；名称不符返回 REPORT_NAME_CONFLICT，不写文件。冲突时重新读取。重试沿用 operationId。", scope: "reports:write", shape: { reportCode, baseCommitHash: z.string().regex(/^[a-f0-9]{40,64}$/), operationId, message: z.string().trim().min(1).max(200), expectedReportName: z.string().trim().min(1).max(160).optional(), files: z.record(z.string(), z.string()).refine(files => Object.keys(files).length <= 30), deleteFiles: z.array(z.string().max(200)).max(20).optional() } },
  prepare_report_local_preview: { description: "准备本地动态预览：仅下载基线，不上传源码、不改草稿。返回可校验SHA256的独立Node运行时与只读数据代理凭据。文件在本机编辑、server.js在本机执行。dataSources只填写已确认使用的数据源名称；空列表不能查DB。启动本地serve并打开返回的127.0.0.1预览URL；反复修改后刷新，验证通过再begin上传+commit。无需Skill。凭据放源码目录外chmod600。", scope: "reports:write", shape: { reportCode, baseCommitHash: z.string().regex(/^[a-f0-9]{40,64}$/), dataSources: z.array(z.string().min(1).max(160)).max(20).optional(), operationId } },
  inspect_report_local_preview_boundary: { description: "只读检查本地开发期间云端草稿的Git版本、文件哈希、脏状态与上传blob数量。提交前必须cloudDraftUnchanged=true、uploadedBlobs=0；不会上传源码或执行本地文件。", scope: "reports:read", shape: { reportCode, sessionId: z.string().regex(/^[a-f0-9]{32}$/) } },
  begin_report_development: { description: "创建绑定当前用户/连接/报表的隔离开发会话，返回基线文件清单及短期文件传输凭据。客户端通过 GET 下载原始文件、PUT 上传清单声明的原始 UTF-8 字节，不把内容放进 MCP JSON。仅暂存，不改正式源码、不发布。本地预览先用 prepare_report_local_preview，验证通过才创建本上传会话。暂不支持 ZIP/二进制；无文件传输工具则继续使用 apply_report_changes。凭据不得写入源码、日志或答复。", scope: "reports:write", shape: { reportCode, baseCommitHash: z.string().regex(/^[a-f0-9]{40,64}$/), files: z.array(developmentFileSchema).max(30), deleteFiles: z.array(z.string().max(200)).max(20).optional(), operationId } },
  inspect_report_development: { description: "校验已上传的不可变开发快照，返回云端开发预览。查询复用 Studio 运行时和当前授权数据源，数据库凭据不下发。结构检查不是指标/数据/视觉验收。未提交正式工作区。先确认客户端可打开页面。", scope: "reports:write", shape: { reportCode, sessionId: z.string().regex(/^[a-f0-9]{32}$/) } },
  commit_report_development: { description: "将已上传的文件原样提交到报表草稿。复用版本冲突、编辑锁、身份/名称校验、指标事务和 Git 提交；不发布。只覆盖清单文件，删除须在创建会话时明确声明。失败不换 operationId 重试；成功后读回检查再关闭会话。", scope: "reports:write", shape: { reportCode, sessionId: z.string().regex(/^[a-f0-9]{32}$/), operationId, message: z.string().trim().min(1).max(200), expectedReportName: z.string().trim().min(1).max(160).optional() } },
  close_report_development: { description: "撤销并删除当前连接的临时开发会话，立即停用其上传和预览凭据；不改报表正式工作区。", scope: "reports:write", shape: { reportCode, sessionId: z.string().regex(/^[a-f0-9]{32}$/) } },
  publish_report: { description: "发布当前已保存工作区为一个新的 Studio 发布版本。仅在用户明确确认发布这份具体报表后调用，并传 confirm=true。不会启用公共分享，也不会发布到资源中心。", scope: "reports:write", shape: { reportCode, operationId, confirm: z.literal(true) } },
  list_resource_categories: { description: "按资源类型列出资源中心可用分类。assetType 可选 report（报告，默认）、template（模板）或 dataset（数据集）；发布前先查询并由用户确认目标分类。", scope: "reports:read", shape: { assetType: z.enum(["report", "template", "dataset"]).optional() } },
  publish_to_resource_center: { description: "将 Studio 报表/报表模板作为资源上架到 DataTalk 资源中心。先按 assetType 查询分类，并向用户确认资源类型、标题/摘要、分类、缩略图及公开范围后传 confirm=true。默认使用 Studio 生成的资源缩略图；可提供受限大小的 PNG/SVG data URL 覆盖。若工作区有未发布版本，会先创建 Studio 发布版本；不会启用公共链接。", scope: "reports:write", shape: { reportCode, operationId, confirm: z.literal(true), assetType: z.enum(["report", "template"]).optional(), categoryId: z.number().int().positive(), title: z.string().trim().min(1).max(160).optional(), summary: z.string().trim().max(500).nullable().optional(), resourceThumbnailDataUrl: z.string().max(1_000_000).optional() } },
  get_report_public_link: { description: "读取当前报表的公共链接状态、URL、密码保护状态和有效期。不会创建、修改或启用链接；不会返回链接密码。", scope: "reports:write", shape: { reportCode } },
  configure_report_public_link: { description: "创建或更新报表公共链接，包括启用/停用、密码保护和有效期。默认不设密码（passwordEnabled 未指定或为 false）。只有明确启用密码保护时，未传 password 才按 Studio 默认规则生成 4 位随机数字密码；仅当用户明确指定自定义密码时才传 password（4 至 20 个字符）。仅在用户明确确认这份报表的公共链接设置后调用，并传 confirm=true。不会在结果中回显密码。", scope: "reports:write", shape: { reportCode, operationId, enabled: z.boolean(), confirm: z.literal(true), passwordEnabled: z.boolean().optional(), password: z.string().min(4).max(20).optional(), expiresAt: z.string().datetime({ offset: true }).nullable().optional(), rotate: z.boolean().optional() } },
  inspect_report: { description: "校验报表结构与运行时，返回当前报表元数据、版本和可在浏览器打开的短时免登录预览链接。用 report.name 核对重命名结果；此工具不会打开页面，不代表需求比对或浏览器视觉验收。先确认客户端预览能力，再调用并立即打开完整 previewUrl（含 #ticket），不做 HTTP 探测；无法截图时标记未检查，避免重复失败尝试。", scope: "reports:read", shape: { reportCode } },
} satisfies Record<string, { description: string; scope: ApiScope | null; shape: z.ZodRawShape }>;
export type StudioToolName = keyof typeof STUDIO_TOOLS;

const KNOWN_ERRORS: Record<string, [number, string]> = {
  METRIC_SQL_VALIDATION_FAILED: [422,"本指标 SQL 校验失败，请核对数据源、表字段与参数后重试；候选未提交"],
  METRIC_CONTENT_REQUIRED: [400,"缺少完整 content 语义正文"],
  METRIC_CONTENT_TOO_LARGE: [400,"语义正文不能超过 60000 字符"],
  METRIC_NAME_INVALID: [400,"指标名称无效"],
  METRIC_KEYWORDS_INVALID: [400,"别名和关键词应为最多 30 个非空短文本"],
  METRIC_DEFINITION_TOO_LARGE: [400,"指标定义或数组超出限制，不会静默截断，请精简或拆分定义"],
  METRIC_BASE_VERSION_REQUIRED: [400,"复用或修改指标必须传入检索得到的 baseVersion"],
  METRIC_NOT_ACTIVE: [409,"指标已归档或删除，请在管理页明确恢复，不能由 AI 自动恢复"],
  METRIC_VERSION_CONFLICT: [409,"指标版本已变化，请重新检索并确认"],
  METRIC_BINDINGS_INVALID: [400,"metricBindings 格式无效，应为不重复的 metricKey/version 数组"],
  METRIC_BINDING_UNAVAILABLE: [409,"指标绑定版本不可用，请重新读取"],
  QUERY_REJECTED: [400, "仅允许单条只读查询，请使用 SELECT 并移除分号与写入语句"],
  QUERY_RESULT_LIMIT: [422, "查询结果超过预览限制，请聚合数据或缩小范围"],
  QUERY_TIMEOUT: [504, "查询超时，请缩小时间范围后重试"],
  QUERY_PARAMETER_MISSING: [400, "查询缺少绑定参数"],
  QUERY_PARAMETER_INVALID: [400, "查询参数格式无效"],
  DATA_SOURCE_NOT_SUPPORTED: [400, "当前数据源暂不支持此操作"],
  WORKING_BASE_CONFLICT: [409, "报表版本已变化，请重新读取后修改"],
  EDIT_LOCK_REQUIRED: [409, "报表正在被其他编辑器使用，请稍后重试"],
  REPORT_NOT_FOUND: [404, "报表不存在或不在当前租户"],
  SOURCE_REPORT_NOT_FOUND: [404, "源报表不存在或不在当前租户"],
  TARGET_FOLDER_NOT_FOUND: [404, "报表目录不存在或不在当前租户"],
  DATA_SOURCE_NOT_FOUND: [404, "数据源不存在或不在当前租户"],
  REPORT_VALIDATION_FAILED: [422, "报表校验失败，改动已回退"],
  COPIED_REPORT_INVALID: [422, "复制后的报表未通过校验"],
  REPORT_NAME_TOO_LONG: [400, "报表名称不能超过 160 个字符"],
  WORKSPACE_DIRTY: [409, "工作区有尚未保存的文件，请先保存并重试"],
  REPORT_FILE_NOT_ALLOWED: [400, "不允许访问该报表文件"],
  REPORT_METADATA_UPDATE_FAILED: [422, "报表元数据无效，改动已回退"],
  RESOURCE_NOT_PUBLISHED: [404, "资源已下架或发布版本不可用"],
  RESOURCE_RELEASE_NOT_FOUND: [404, "资源对应的已发布版本不可用"],
  RESOURCE_VERSION_CHANGED: [409, "资源版本已变化，请重新搜索并确认后再复制"],
};
function normalizeError(error: unknown): OpenApiError {
  if (error instanceof OpenApiError) return error;
  const code = error instanceof Error ? error.message : "";
  const known = KNOWN_ERRORS[code];
  if (known) return new OpenApiError(code, known[0], known[1], (error as { issues?: unknown }).issues);
  return new OpenApiError("STUDIO_OPERATION_FAILED", 500, "Studio 操作失败，请查看服务日志后重试");
}
function directories(folders: Awaited<ReturnType<typeof listReports>>["folders"]): unknown[] {
  return folders.map(({ reports: _reports, children, ...folder }) => ({ ...folder, children: directories(children) }));
}
async function reportOrThrow(principal: ApiPrincipal, code: string) {
  const detail = await getReportDetailByCode(principal.tenantId, code);
  if (!detail) throw new OpenApiError("REPORT_NOT_FOUND", 404, "报表不存在或不在当前租户");
  return detail;
}
async function fileNames(tenantId: number, code: string) {
  const root = getReportWorkingPath(tenantId, code);
  const result: string[] = [];
  async function walk(relative: string) {
    for (const entry of await fs.readdir(`${root}/${relative}`, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && ["data", "assets", "components"].includes(file.split("/")[0])) await walk(file);
      else if (entry.isFile() && isAllowedReportSourceFile(file)) result.push(file);
    }
  }
  await walk(""); return result.sort();
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function idempotent(principal: ApiPrincipal, tool: string, args: Record<string, unknown>, run: () => Promise<unknown>) {
  const id = String(args.operationId);
  const digest = createHash("sha256").update(canonical({ tool, args })).digest("hex");
  try {
    await getDbPool().execute("INSERT INTO studio_api_operation (tenant_id,user_id,operation_id,input_digest,created_at) VALUES (?,?,?,?,?)", [principal.tenantId, principal.userId, id, digest, new Date().toISOString()]);
  } catch (error) {
    if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    const [rows] = await getDbPool().query<Array<RowDataPacket & { input_digest: string; result_json: string | null }>>("SELECT input_digest,result_json FROM studio_api_operation WHERE tenant_id=? AND user_id=? AND operation_id=?", [principal.tenantId, principal.userId, id]);
    if (rows[0]?.input_digest !== digest) throw new OpenApiError("IDEMPOTENCY_CONFLICT", 409, "此 operationId 已用于不同内容，请使用新的 ID");
    if (!rows[0].result_json) throw new OpenApiError("OPERATION_PENDING", 409, "操作仍在执行或等待恢复，请勿换 ID 重复创建。读取报表并联系管理员检查");
    const stored = JSON.parse(rows[0].result_json);
    if (stored.error) throw new OpenApiError(stored.error.code, stored.error.status, stored.error.message, stored.error.details);
    return stored.result;
  }
  let envelope: { result?: unknown; error?: OpenApiError };
  try { envelope = { result: await run() }; } catch (error) { envelope = { error: normalizeError(error) }; }
  const stored = envelope.error ? { error: { code: envelope.error.code, status: envelope.error.status, message: envelope.error.message, details: envelope.error.details } } : envelope;
  await getDbPool().execute("UPDATE studio_api_operation SET result_json=? WHERE tenant_id=? AND user_id=? AND operation_id=?", [JSON.stringify(stored), principal.tenantId, principal.userId, id]);
  if (envelope.error) throw envelope.error;
  return envelope.result;
}
async function execute(principal: ApiPrincipal, name: StudioToolName, args: Record<string, any>, baseUrl: string): Promise<unknown> {
  const tenantId = principal.tenantId;
  switch (name) {
    case "search_metric_knowledge": return searchMetricKnowledge(tenantId, args as { query: string });
    case "read_report_metric_bindings": {
      await reportOrThrow(principal, args.reportCode);
      return readReportMetricBindings(tenantId,args.reportCode);
    }
    case "propose_metric_knowledge": {
      await reportOrThrow(principal,args.reportCode);
      if (args.validationSql) {
        requireApiScope(principal,"data:query");
        try { await previewReportAgentSql({ tenantId,dataSourceRef: args.dataSource,sql: args.validationSql,params: args.validationParams,maxRows: 5 }); }
        catch { throw new Error("METRIC_SQL_VALIDATION_FAILED"); }
      }
      return proposeMetricKnowledge({ ...args, tenantId,reportCode: args.reportCode,userId: principal.userId,
        dshSessionId: `external:${principal.userId}:${args.reportCode}`,sqlPreviewValidated: Boolean(args.validationSql) });
    }
    case "get_studio_context": {
      const center = principal.scopes.includes("reports:read") ? await listReports(tenantId) : null;
      return { apiVersion: "v1", workflowContract: STUDIO_WORKFLOW, identity: { tenantId, userId: principal.userId, name: principal.name, role: principal.role }, scopes: principal.scopes,
        tools: Object.entries(STUDIO_TOOLS).filter(([name, t]) => (!t.scope || principal.scopes.includes(t.scope)) && (isResourceCenterEnabled() || !["list_resource_categories", "publish_to_resource_center", "list_public_resources", "copy_public_resource"].includes(name))).map(([name]) => name),
        folders: center ? directories(center.folders) : [],
        reportEditingEnabled: principal.scopes.includes("reports:write"),
        reportEditLockEnabled: isReportEditLockEnabled(),
        fileDevelopmentContract: { version: "2", mode: "local-edit-local-dynamic-preview-explicit-upload", prepareLocalTool: "prepare_report_local_preview", verifyBoundaryTool: "inspect_report_local_preview_boundary", createTool: "begin_report_development", inspectTool: "inspect_report_development", commitTool: "commit_report_development", closeTool: "close_report_development", transfer: "raw UTF-8 bytes over scoped HTTP capability; no database credentials", maxFileBytes: 524288, maxUploadFiles: 30, maxTotalBytes: 16777216, binarySupported: false, zipSupported: false, localDynamicPreviewSupported: true },
        reportContract: { schemaVersion: "1.0", entry: "page.html", format: "web", requiredFiles: ["report.json", "description.md", "page.html", "styles.css", "app.js", "server.js"], serverRuntime: "module.exports = { handlers: {} }; use the Studio template; server.js is a handler module, not a listening HTTP server", previewRequiresLogin: false, previewTool: "inspect_report", publishingAvailable: true, publicationTool: "publish_report", publicSharingAvailable: true, publicLinkSettingsReadable: true, publicLinkManagementAvailable: true, publicLinkManagementTool: "configure_report_public_link", resourceCenterPublishingAvailable: isResourceCenterEnabled(), resourceCenterCategoryTool: isResourceCenterEnabled() ? "list_resource_categories" : null, resourceCenterPublishingTool: isResourceCenterEnabled() ? "publish_to_resource_center" : null, publicResourceDiscoveryAvailable: isResourceCenterEnabled(), publicResourceListTool: isResourceCenterEnabled() ? "list_public_resources" : null, publicResourceCopyTool: isResourceCenterEnabled() ? "copy_public_resource" : null },
        metricContract: { searchTool: "search_metric_knowledge", bindingsTool: "read_report_metric_bindings", proposalTool: "propose_metric_knowledge", commitTool: "apply_report_changes", contentFormat: "plain text with business definition, source table/column mapping, formula, grain, time, joins, filters, deduplication, dimensions, units, SQL example and unknowns", newMetricBaseVersion: 0, existingMetricBaseVersion: "Use the current version returned by search; never guess", confirmation: "confirmed=true only after actual user confirmation", validation: "Pass candidate-specific validationSql and dataSource", binding: "Write returned metricKey/version to report.json.metricBindings; preserve other bindings", completion: "Check saved=true and metricKnowledge; pending/drafts/rejected do not mean effective", automaticEmbedding: "After finalization; unchanged valid index is reused" },
        limits: { queryRows: 20, queryBytes: 262144, requestBytes: 2097152, fileBytes: 524288 } };
    }
    case "list_data_sources": return { dataSources: await listReportAgentDataSources(tenantId) };
    case "inspect_data_source_schema": return getReportAgentDataSourceSchema({ tenantId, ...args } as Parameters<typeof getReportAgentDataSourceSchema>[0]);
    case "preview_query": return previewReportAgentSql({ tenantId, ...args } as Parameters<typeof previewReportAgentSql>[0]);
    case "list_reports": return listReports(tenantId);
    case "read_report": {
      const detail = await reportOrThrow(principal, args.reportCode);
      const availableFiles = await fileNames(tenantId, args.reportCode);
      const requested: string[] = args.files || ["report.json", "description.md", "page.html", "styles.css", "app.js", "server.js"];
      const files: Record<string, string> = {}; let bytes = 0;
      for (const file of requested) {
        if (!isAllowedReportSourceFile(file) || !availableFiles.includes(file)) throw new OpenApiError("REPORT_FILE_NOT_ALLOWED", 400, `文件不存在或不可读取：${file}`);
        const content = await readReportWorkspaceFile(tenantId, args.reportCode, file);
        const length = Buffer.byteLength(content); bytes += length;
        if (length > 524288 || bytes > 1572864) throw new OpenApiError("FILE_LIMIT", 413, "源码过大，请分批读取");
        files[file] = content;
      }
      return { report: detail.report, baseCommitHash: detail.workingCommitHash, availableFiles, files };
    }
    case "create_report": return idempotent(principal, name, args, async () => {
      const report = await createReport({ tenantId, folderId: args.folderId, name: args.name, ownerId: principal.userId, ownerName: principal.name });
      if (!report) throw new OpenApiError("FOLDER_NOT_FOUND", 404, "报表目录不存在或不在当前租户");
      const commitHash = await commitWorkspace(tenantId, report.code, "Initialize external report", randomUUID());
      await getDbPool().execute("UPDATE tenant_report SET working_commit_hash=? WHERE tenant_id=? AND code=?", [commitHash, tenantId, report.code]);
      return { report, baseCommitHash: commitHash, previewUrl: `${baseUrl}/preview/${report.code}`, previewRequiresLogin: true, previewHint: "请调用 inspect_report 获取短时免登录预览链接" };
    });
    case "rename_report": return idempotent(principal, name, args, async () => {
      const lock = await acquireReportEditLock({ ...principal, reportCode: args.reportCode });
      if (!lock) throw new OpenApiError("EDIT_LOCK_REQUIRED", 409, "报表正在被其他编辑器使用，请稍后重试");
      try {
        const result = await renameReport({ tenantId, reportCode: args.reportCode, userId: principal.userId, name: args.name, lockToken: lock.lockToken });
        return { report: (await reportOrThrow(principal, args.reportCode)).report, ...result, renamed: true, sourceChanged: false, nextStep: "若需同步页面标题，先 read_report，再最小修改 report.json.name 和 HTML 标题；部分失败不影响已经成功的元数据重命名" };
      } finally { await releaseReportEditLock(tenantId, args.reportCode, lock.lockToken); }
    });
    case "copy_report": return idempotent(principal, name, args, async () => {
      const lock = await acquireReportEditLock({ ...principal, reportCode: args.reportCode });
      if (!lock) throw new OpenApiError("EDIT_LOCK_REQUIRED", 409, "源报表正在被其他编辑器使用，请稍后重试");
      try {
        if ((await getWorkspaceStatus(tenantId, args.reportCode, "working")).length) throw new OpenApiError("WORKSPACE_DIRTY", 409, "源报表有尚未保存的文件，请先保存后再复制");
        const result = await copyWorkingReport({ tenantId, sourceCode: args.reportCode, ownerId: principal.userId, ownerName: principal.name, name: args.name });
        const detail = await reportOrThrow(principal, result.report.code);
        return { report: detail.report, baseCommitHash: detail.workingCommitHash, copiedFromReportCode: args.reportCode, state: "draft" };
      } finally { await releaseReportEditLock(tenantId, args.reportCode, lock.lockToken); }
    });
    case "list_public_resources": {
      if (!isResourceCenterEnabled()) throw new OpenApiError("RESOURCE_CENTER_DISABLED", 404, "公共资源发现能力未启用");
      return listPublishedPublicResources(args);
    }
    case "copy_public_resource": return idempotent(principal, name, args, async () => {
      if (!isResourceCenterEnabled()) throw new OpenApiError("RESOURCE_CENTER_DISABLED", 404, "公共资源复制能力未启用");
      const resource = await getPublishedPublicResourceById(args.resourceId);
      if (!resource) throw new OpenApiError("RESOURCE_NOT_PUBLISHED", 404, "资源已下架或发布版本不可用");
      const copied = await copyPublishedResourceReport({
        targetTenantId: tenantId, ownerId: principal.userId, ownerName: principal.name || principal.username,
        sourceTenantId: resource.sourceTenantId, sourceCode: resource.sourceCode, sourceAssetType: resource.assetType,
        sourceVersion: resource.version, name: args.name,
      });
      const detail = await reportOrThrow(principal, copied.report.code);
      return {
        report: detail.report, baseCommitHash: detail.workingCommitHash,
        state: copied.reused ? "reused" : "draft", reused: copied.reused,
        source: { resourceId: resource.id, assetType: resource.assetType, code: resource.sourceCode, version: resource.version, title: resource.title },
        message: copied.reused ? "该资源已属于当前用户；未创建重复草稿，可使用 copy_report 创建副本" : "已从公开资源的发布版本复制为独立草稿；请使用 read_report 查看源码后编辑",
      };
    });
    case "publish_report": return idempotent(principal, name, args, async () => {
      await reportOrThrow(principal, args.reportCode);
      const lock = await acquireReportEditLock({ ...principal, reportCode: args.reportCode });
      if (!lock) throw new OpenApiError("EDIT_LOCK_REQUIRED", 409, "报表正在被其他编辑器使用，请稍后重试");
      const renewal = setInterval(() => { void renewReportEditLock(tenantId, args.reportCode, lock.lockToken).catch(() => {}); }, 15000);
      try {
        const dirtyFiles = await getWorkspaceStatus(tenantId, args.reportCode, "working");
        if (dirtyFiles.length) throw new OpenApiError("WORKSPACE_DIRTY", 409, "工作区有尚未保存的文件，请先保存并重新检查后再发布");
        const published = await publishReport(tenantId, args.reportCode, principal.userId);
        return { ...published, published: true, publicSharingEnabled: false, resourceCenterPublished: false, message: "Studio 发布版本已创建；公共分享和资源中心发布未启用" };
      } finally { clearInterval(renewal); await releaseReportEditLock(tenantId, args.reportCode, lock.lockToken); }
    });
    case "list_resource_categories": {
      if (!isResourceCenterEnabled()) throw new OpenApiError("RESOURCE_CENTER_DISABLED", 404, "资源中心能力未启用");
      const assetType = (args.assetType || "report") as ResourceAssetType;
      return { assetType, categories: await listResourceCategories(assetType) };
    }
    case "publish_to_resource_center": return idempotent(principal, name, args, async () => {
      if (!isResourceCenterEnabled()) throw new OpenApiError("RESOURCE_CENTER_DISABLED", 404, "资源中心能力未启用");
      validateResourceThumbnailDataUrl(args.resourceThumbnailDataUrl);
      const detail = await reportOrThrow(principal, args.reportCode);
      const assetType = (args.assetType || "report") as ResourceAssetType;
      const categories = await listResourceCategories(assetType);
      if (!categories.some(category => category.id === args.categoryId)) throw new OpenApiError("RESOURCE_CATEGORY_NOT_FOUND", 400, "资源分类不存在或已停用，请重新获取分类列表");
      const lock = await acquireReportEditLock({ ...principal, reportCode: args.reportCode });
      if (!lock) throw new OpenApiError("EDIT_LOCK_REQUIRED", 409, "报表正在被其他编辑器使用，请稍后重试");
      const renewal = setInterval(() => { void renewReportEditLock(tenantId, args.reportCode, lock.lockToken).catch(() => {}); }, 15000);
      try {
        if ((await getWorkspaceStatus(tenantId, args.reportCode, "working")).length) throw new OpenApiError("WORKSPACE_DIRTY", 409, "工作区有尚未保存的文件，请先保存并重新检查后再上架");
        const publicationState = await getReportResourcePublicationState(tenantId, args.reportCode);
        if (!publicationState) throw new OpenApiError("REPORT_NOT_FOUND", 404, "报表不存在或不在当前租户");
        let releaseVersion = publicationState.currentReleaseVersion;
        let reportPublished = false;
        if (!releaseVersion || publicationState.workingCommitHash !== publicationState.publishedCommitHash) {
          releaseVersion = (await publishReport(tenantId, args.reportCode, principal.userId, { resourceThumbnailDataUrl: args.resourceThumbnailDataUrl })).version;
          reportPublished = true;
        } else if (args.resourceThumbnailDataUrl) {
          await writeResourceThumbnailDataUrl({ tenantId, reportCode: args.reportCode, version: releaseVersion, dataUrl: args.resourceThumbnailDataUrl });
        }
        if (!releaseVersion) throw new OpenApiError("REPORT_NOT_PUBLISHED", 409, "报表发布失败，无法上架资源中心");
        const title = args.title || detail.definition?.title || detail.report.name;
        const summary = args.summary === undefined ? detail.definition?.subTitle || null : args.summary;
        const thumbnailUrl = buildReleaseThumbnailUrl(args.reportCode, releaseVersion, args.resourceThumbnailDataUrl ? Date.now() : null, "resource");
        const resourceItem = await upsertResourceItem({ tenantId, userId: principal.userId, assetType, sourceCode: args.reportCode,
          sourceVersion: releaseVersion, title, summary, thumbnailUrl, categoryId: args.categoryId });
        if (!resourceItem || resourceItem.status !== "published") throw new OpenApiError("RESOURCE_PUBLICATION_FAILED", 500, "资源中心条目未进入已发布状态");
        return { reportCode: args.reportCode, resourceCenterPublished: true, resourceItem, releaseVersion, reportPublished,
          assetType, thumbnailUrl, customThumbnailProvided: Boolean(args.resourceThumbnailDataUrl), message: "资源已发布到资源中心；此操作不会启用公共链接" };
      } finally { clearInterval(renewal); await releaseReportEditLock(tenantId, args.reportCode, lock.lockToken); }
    });
    case "get_report_public_link": {
      const detail = await reportOrThrow(principal, args.reportCode);
      const link = await getCurrentReportPublicLink(tenantId, args.reportCode);
      const expiresAt = link?.publicLinkExpiresAt || null;
      const enabled = Boolean(detail.report.publicLinkEnabled && link);
      return {
        reportCode: args.reportCode,
        enabled,
        publicUrl: enabled ? `${baseUrl}/link/${encodeURIComponent(link!.publicLinkCode)}` : null,
        passwordProtected: enabled && link!.publicLinkPasswordEnabled,
        expiresAt,
        expired: Boolean(enabled && expiresAt && new Date(expiresAt).getTime() <= Date.now()),
        passwordReturned: false,
      };
    }
    case "configure_report_public_link": return idempotent(principal, name, args, async () => {
      const detail = await reportOrThrow(principal, args.reportCode);
      if (args.enabled && !await getReportReleaseDetailByCode(tenantId, args.reportCode)) throw new OpenApiError("REPORT_NOT_PUBLISHED", 409, "请先在 Studio 发布报表，再启用公共链接");
      if (args.password !== undefined && args.passwordEnabled !== true) throw new OpenApiError("PUBLIC_LINK_PASSWORD_UNEXPECTED", 400, "只有启用密码保护时才能设置密码");
      const currentLink = args.enabled ? await getCurrentReportPublicLink(tenantId, args.reportCode) : null;
      const expiresAt = args.expiresAt === undefined || args.expiresAt === null ? args.expiresAt : new Date(args.expiresAt);
      if (expiresAt instanceof Date && expiresAt.getTime() <= Date.now()) throw new OpenApiError("PUBLIC_LINK_EXPIRY_INVALID", 400, "有效期必须晚于当前时间");
      const result = await updateReportPublicLink({ tenantId, reportCode: args.reportCode, userId: principal.userId,
        enabled: args.enabled, passwordEnabled: args.passwordEnabled, password: args.password,
        resetPassword: args.password !== undefined, rotate: args.rotate === true, expiresAt });
      if (!result) throw new OpenApiError("REPORT_NOT_FOUND", 404, "报表不存在或不在当前租户");
      const active = args.enabled && Boolean(result.publicLinkCode);
      return { reportCode: args.reportCode, enabled: active, publicUrl: active ? `${baseUrl}/link/${encodeURIComponent(result.publicLinkCode!)}` : null,
        passwordProtected: active && result.publicLinkPasswordEnabled, passwordSet: active && result.publicLinkPasswordEnabled,
        expiresAt: active ? result.publicLinkExpiresAt : null, passwordReturned: false,
        message: active ? "公共链接设置已更新；密码不会在结果中返回，请由设置者妥善保管" : "公共链接已停用" };
    });
    case "inspect_report_local_preview_boundary": return inspectLocalPreviewBoundary(principal, args.reportCode, args.sessionId);
    case "prepare_report_local_preview": return idempotent(principal, name, args, async () => {
      await reportOrThrow(principal, args.reportCode);
      const lock = await acquireReportEditLock({ ...principal, reportCode: args.reportCode });
      if (!lock) throw new OpenApiError("EDIT_LOCK_REQUIRED", 409, "报表正在被其他编辑器使用");
      try { return await prepareReportLocalPreview(principal, args as any, baseUrl); }
      finally { await releaseReportEditLock(tenantId, args.reportCode, lock.lockToken); }
    });
    case "begin_report_development": return idempotent(principal, name, args, async () => {
      await reportOrThrow(principal, args.reportCode);
      const lock = await acquireReportEditLock({ ...principal, reportCode: args.reportCode });
      if (!lock) throw new OpenApiError("EDIT_LOCK_REQUIRED", 409, "报表正在被其他编辑器使用");
      try { return await beginReportDevelopment(principal, args as any, baseUrl); }
      finally { await releaseReportEditLock(tenantId, args.reportCode, lock.lockToken); }
    });
    case "inspect_report_development": return inspectReportDevelopment(principal, args.reportCode, args.sessionId, baseUrl);
    case "close_report_development": return closeReportDevelopment(principal, args.reportCode, args.sessionId);
    case "commit_report_development": return idempotent(principal, name, args, async () => {
      const staged = await developmentChangesForCommit(principal, args.reportCode, args.sessionId);
      if (!Object.keys(staged.files).length && !staged.deleteFiles.length) throw new OpenApiError("EMPTY_CHANGE_SET", 400, "下载会话没有变更，不能提交；请生成变更清单后创建新会话");
      // Keep the existing transactional commit and metric lifecycle; no alternative write path.
      return execute(principal, "apply_report_changes", {
        reportCode: args.reportCode, baseCommitHash: staged.session.baseCommitHash,
        operationId: `dev_${createHash("sha256").update(args.operationId).digest("hex")}`,
        message: args.message, expectedReportName: args.expectedReportName,
        files: staged.files, deleteFiles: staged.deleteFiles, __preserveSourceBytes: true,
      }, baseUrl);
    });
    case "apply_report_changes": {
      for (const [file, content] of Object.entries(args.files)) {
        if (!isAllowedReportSourceFile(file) || file.includes("\\")) throw new OpenApiError("REPORT_FILE_NOT_ALLOWED", 400, `文件不可修改：${file}`);
        if (Buffer.byteLength(content as string) > 524288) throw new OpenApiError("FILE_LIMIT", 413, "单个文件不能超过 512KB");
      }
      for (const file of args.deleteFiles || []) if (!isAllowedReportSourceFile(file) || file === "report.json" || file in args.files) throw new OpenApiError("REPORT_FILE_NOT_ALLOWED", 400, "删除文件列表无效");
      if (args.files["report.json"]) {
        let manifest: Record<string, unknown>;
        try { manifest = JSON.parse(args.files["report.json"]); } catch { throw new OpenApiError("INVALID_MANIFEST", 422, "report.json 不是有效 JSON"); }
        if (!manifest || Number(manifest.tenantId) !== tenantId || manifest.reportCode !== args.reportCode) throw new OpenApiError("INVALID_MANIFEST", 422, "不能修改报表身份或租户");
      }
      return idempotent(principal, name, args, async () => {
        await reportOrThrow(principal, args.reportCode);
        const lock = await acquireReportEditLock({ ...principal, reportCode: args.reportCode });
        if (!lock) throw new OpenApiError("EDIT_LOCK_REQUIRED", 409, "报表正在被其他编辑器使用，请稍后重试");
        const renewal = setInterval(() => { void renewReportEditLock(tenantId, args.reportCode, lock.lockToken).catch(() => {}); }, 15000);
        try {
          const current = await reportOrThrow(principal, args.reportCode);
          if (args.expectedReportName !== undefined && current.report.name !== args.expectedReportName) {
            throw new OpenApiError("REPORT_NAME_CONFLICT", 409, "报表名称已变化，请重新读取并确认编辑范围", { currentName: current.report.name });
          }
          const head = await getWorkspaceHead(tenantId, args.reportCode);
          if (head !== args.baseCommitHash) throw new OpenApiError("WORKING_BASE_CONFLICT", 409, "报表版本已变化，请重新读取", { currentCommitHash: head });
          if ((await getWorkspaceStatus(tenantId, args.reportCode, "working")).length) throw new OpenApiError("WORKSPACE_DIRTY", 409, "报表有尚未提交的编辑，请先在 Studio 完成保存");
          const result = await applyReportChanges({ preserveSourceBytes: args.__preserveSourceBytes === true, metricSessionId: `external:${principal.userId}:${args.reportCode}`, tenantId, reportCode: args.reportCode, userId: principal.userId, baseCommitHash: args.baseCommitHash, lockToken: lock.lockToken, message: args.message, changeSet: { files: args.files, deleteFiles: args.deleteFiles } });
          return { ...result, saved: true, report: current.report, acceptance: { structure: result.validation.valid ? "passed" : "failed", requirements: "not_checked", visual: "not_checked" }, previewUrl: `${baseUrl}/preview/${args.reportCode}`, previewRequiresLogin: true, previewHint: "请调用 inspect_report 获取短时免登录预览链接" };
        } catch (error) {
          if (error instanceof Error && error.message === "AUDIT_PENDING") return { saved: true, auditStatus: "pending", commitHash: await getWorkspaceHead(tenantId, args.reportCode), message: "源码已提交；版本登记待管理员恢复，请勿重复写入" };
          throw error;
        } finally { clearInterval(renewal); await releaseReportEditLock(tenantId, args.reportCode, lock.lockToken); }
      });
    }
    case "inspect_report": {
      const detail = await reportOrThrow(principal, args.reportCode);
      const validation = await validateReportWorkspace(tenantId, args.reportCode);
      // Manifest comparison is deterministic; dynamic DOM titles still require a browser.
      let manifestName: string | null = null;
      try {
        const manifest = JSON.parse(await readReportWorkspaceFile(tenantId, args.reportCode, "report.json"));
        if (typeof manifest?.name === "string") manifestName = manifest.name;
      } catch { /* Validation reports malformed/missing files; do not hide the other results. */ }
      return { report: detail.report, validation, commitHash: await getWorkspaceHead(tenantId, args.reportCode),
        workflowVersion: STUDIO_WORKFLOW.version,
        nameConsistency: { metadataName: detail.report.name, manifestName, status: manifestName === null ? "not_checked" : manifestName === detail.report.name ? "passed" : "mismatch", pageTitle: "not_checked" },
        acceptance: { structure: validation.valid ? "passed" : "failed", requirements: "not_checked", visual: "not_checked" },
        ...await createPreviewLink(principal, args.reportCode, baseUrl), visualInspectionPerformed: false,
        previewInstructions: STUDIO_WORKFLOW.preview };

    }
  }
}
export async function invokeStudioTool(principal: ApiPrincipal, name: string, input: unknown, baseUrl: string) {
  if (!Object.hasOwn(STUDIO_TOOLS, name)) throw new OpenApiError("UNKNOWN_TOOL", 404, "工具不存在");
  const tool = STUDIO_TOOLS[name as StudioToolName];
  let status = "success"; let target: string | null = null;
  try {
    if (tool.scope) requireApiScope(principal, tool.scope);
    const parsed = z.object(tool.shape).strict().safeParse(input);
    if (!parsed.success) throw new OpenApiError("INVALID_ARGUMENTS", 400, "工具参数不符合要求", parsed.error.issues.map(i => ({ path: i.path, message: i.message })));
    target = (parsed.data as { reportCode?: string }).reportCode || null;
    const result = await execute(principal, name as StudioToolName, parsed.data, baseUrl);
    if (name === "create_report") target = (result as { report?: { code?: string } }).report?.code || null;
    if ((result as { auditStatus?: string })?.auditStatus === "pending") status = "AUDIT_PENDING";
    return result;
  }
  catch (error) { const normalized = normalizeError(error); status = normalized.code; throw normalized; }
  finally {
    // Store metadata only: no key, SQL, query rows or report source in logs.
    try { await ensureConnectionSchema(); await getDbPool().execute("INSERT INTO studio_api_log (tenant_id,user_id,key_id,oauth_grant_id,tool,report_code,status,created_at) VALUES (?,?,?,?,?,?,?,?)", [principal.tenantId, principal.userId, principal.keyId, principal.oauthGrantId || null, name, target, status, new Date().toISOString()]); }
    catch { console.error("Open API invocation metadata could not be recorded", { tool: name, status }); }
  }
}
