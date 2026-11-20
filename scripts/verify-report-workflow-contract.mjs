// Isolated behavior regression: real tool dispatch + rename service, fake storage.
// No real database, credentials, browser, or network is used.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = {
  report: { code: "workflow_fixture", name: "旧报表名", status: "草稿", publicLinkEnabled: false },
  source: "<title>正文的新标题</title><h1>正文的新标题</h1>",
  head: "a".repeat(40), validation: { valid: true, issues: [] },
  operations: new Map(), writes: 0, reads: 0, previews: 0, validations: 0, locked: false,
};
const handlers = {};
globalThis.reportWorkflowFixture = { call(name, ...args) {
  if (!handlers[name]) throw new Error(`Unexpected dependency: ${name}`);
  return handlers[name](...args);
} };

const modules = {
  "report-metric-knowledge-service": "searchMetricKnowledge readReportMetricBindings proposeMetricKnowledge finalizeMetricKnowledgeProposals parseMetricBindings",
  "studio-preview": "createPreviewLink getReportPreviewSession",
  "studio-connection-schema": "ensureConnectionSchema",
  mysql: "getDbPool",
  "report-repository": "createReport listReports getReportDetailByCode getReportReleaseDetailByCode getCurrentReportPublicLink updateReportPublicLink",
  "report-agent-tools": "listReportAgentDataSources getReportAgentDataSourceSchema previewReportAgentSql",
  "report-copy-service": "copyPublishedResourceReport copyWorkingReport",
  "local-git": "getWorkspaceHead getWorkspaceStatus commitWorkspace deleteReportSourceFile restoreWorkspace writeReportSourceFile",
  "report-schema": "validateReportWorkspace readReportWorkspaceFile",
  "report-workspace": "getReportWorkingPath isAllowedReportSourceFile getReportWorkspacePath initializeReportWorkspace assertReportCode isAllowedReportWorkingFile resolveReportSourcePath resolveReportWorkingPath",
  "report-edit-lock": "acquireReportEditLock renewReportEditLock releaseReportEditLock isReportEditLockEnabled getReportEditLock",
  "resource-center-config": "isResourceCenterEnabled",
  "resource-repository": "getPublishedPublicResourceById getReportResourcePublicationState listPublishedPublicResources listResourceCategories upsertResourceItem",
  "report-release-thumbnail": "buildReleaseThumbnailUrl writeResourceThumbnailDataUrl writeReleaseThumbnail",
};
const mocks = Object.fromEntries(Object.entries(modules).map(([module, names]) => [
  `@/lib/server/${module}`,
  names.split(" ").map(name => `export function ${name}(...args){return globalThis.reportWorkflowFixture.call(${JSON.stringify(name)},...args)}`).join("\n"),
]));
mocks["@/lib/server/report-development"] = `
import { z } from "zod";
export const developmentFileSchema = z.object({ path: z.string(), size: z.number(), sha256: z.string() });
export const beginReportDevelopment = () => { throw new Error('not used in mock test'); };
export const inspectReportDevelopment = beginReportDevelopment;
export const developmentChangesForCommit = beginReportDevelopment;
export const closeReportDevelopment = beginReportDevelopment;
`;
mocks["@/lib/server/open-api-auth"] = `
export class OpenApiError extends Error { constructor(code,status,message,details){super(message);Object.assign(this,{code,status,details})} }
export function requireApiScope(principal,scope){if(!principal.scopes.includes(scope))throw new OpenApiError('FORBIDDEN',403,'scope missing')}
`;

const pool = {
  async execute(sql, args) {
    if (sql.startsWith("INSERT INTO studio_api_log")) return [{ affectedRows: 1 }];
    if (sql.startsWith("INSERT INTO studio_api_operation")) {
      const key = JSON.stringify(args.slice(0, 3));
      if (fixture.operations.has(key)) throw Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      fixture.operations.set(key, { input_digest: args[3], result_json: null });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE studio_api_operation SET result_json")) {
      fixture.operations.get(JSON.stringify(args.slice(1))).result_json = args[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE tenant_report SET name=")) {
      assert.match(sql, /WHERE tenant_id=\? AND code=\? AND deleted_at IS NULL/);
      assert.deepEqual(args.slice(1), [7, fixture.report.code]);
      fixture.report.name = args[0]; fixture.writes++;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL mutation: ${sql}`);
  },
  async query(sql, args) {
    if (sql.startsWith("SELECT input_digest,result_json")) return [[fixture.operations.get(JSON.stringify(args))]];
    if (sql.startsWith("SELECT code FROM tenant_report")) {
      assert.match(sql, /tenant_id=\? AND code=\? AND deleted_at IS NULL/);
      return [args[0] === 7 && args[1] === fixture.report.code ? [{ code: fixture.report.code }] : []];
    }
    throw new Error(`Unexpected SQL read: ${sql}`);
  },
};
Object.assign(handlers, {
  getDbPool: () => pool,
  ensureConnectionSchema: async () => {},
  isReportEditLockEnabled: () => true,
  acquireReportEditLock: async () => fixture.locked ? null : { lockToken: "fixture-lock" },
  getReportEditLock: async () => ({ userId: 9, lockToken: "fixture-lock" }),
  releaseReportEditLock: async () => {},
  getReportDetailByCode: async (tenantId, code) => {
    fixture.reads++;
    return tenantId === 7 && code === fixture.report.code ? { report: { ...fixture.report } } : null;
  },
  validateReportWorkspace: async (tenantId, code) => {
    assert.deepEqual([tenantId, code], [7, fixture.report.code]); fixture.validations++;
    return fixture.validation;
  },
  getWorkspaceHead: async () => fixture.head,
  createPreviewLink: async (principal, code) => {
    assert.deepEqual([principal.tenantId, code], [7, fixture.report.code]); fixture.previews++;
    return { previewUrl: "https://example.invalid/preview/workflow_fixture#ticket=fixture-only" };
  },
});

const dir = await mkdtemp(path.join(tmpdir(), "report-workflow-contract-"));
try {
  const bundle = await build({
    entryPoints: [path.join(root, "lib/server/open-api-tools.ts")],
    bundle: true, write: false, format: "esm", platform: "node",
    plugins: [{ name: "isolated-dependencies", setup(b) {
      b.onResolve({ filter: /^@\// }, args => {
        if (mocks[args.path]) return { path: args.path, namespace: "fixture" };
        if (args.path === "@/lib/server/studio-mcp-contract") return { path: path.join(root, "lib/server/studio-mcp-contract.ts") };
        if (args.path === "@/lib/server/report-workspace-service") return { path: path.join(root, "lib/server/report-workspace-service.ts") };
        throw new Error(`Unisolated dependency: ${args.path}`);
      });
      b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], resolveDir: root }));
    } }],
  });
  const output = path.join(dir, "tools.mjs");
  await writeFile(output, bundle.outputFiles[0].text);
  const { invokeStudioTool } = await import(pathToFileURL(output).href);
  const principal = { tenantId: 7, userId: 9, keyId: 1, name: "Fixture", role: "developer", scopes: ["reports:read", "reports:write"] };
  const inspect = (identity = principal) => invokeStudioTool(identity, "inspect_report", { reportCode: fixture.report.code }, "https://example.invalid");
  const before = await inspect();
  assert.equal(before.report.name, "旧报表名");
  assert.equal(before.visualInspectionPerformed, false);
  assert.equal(before.commitHash, fixture.head);
  assert.equal(fixture.writes, 0);
  console.log("PASS inspect exposes actual metadata, not the changed inner title, without modifying report state");

  const renameArgs = { reportCode: fixture.report.code, name: "新报表名", operationId: "rename_fixture_001" };
  const rename = await invokeStudioTool(principal, "rename_report", renameArgs, "https://example.invalid");
  assert.equal(rename.renamed, true); assert.equal(rename.report.name, "新报表名");
  assert.equal(fixture.source, "<title>正文的新标题</title><h1>正文的新标题</h1>");
  assert.equal(fixture.report.status, "草稿"); assert.equal(fixture.report.publicLinkEnabled, false);
  assert.equal(fixture.writes, 1);
  console.log("PASS real rename service updates tenant-scoped metadata only; source/publication/sharing remain unchanged");

  const replay = await invokeStudioTool(principal, "rename_report", renameArgs, "https://example.invalid");
  assert.deepEqual(replay, rename); assert.equal(fixture.writes, 1);
  await assert.rejects(invokeStudioTool(principal, "rename_report", { ...renameArgs, name: "different" }, "https://example.invalid"), { code: "IDEMPOTENCY_CONFLICT" });
  console.log("PASS identical operation replay does not rename twice; changed payload conflicts");

  const after = await inspect();
  assert.equal(after.report.name, "新报表名"); assert.equal(after.report.code, before.report.code);
  assert.equal(after.commitHash, before.commitHash); assert.equal(after.visualInspectionPerformed, false);
  fixture.validation = { valid: false, issues: ["fixture missing asset"] };
  const invalid = await inspect();
  assert.equal(invalid.report.name, "新报表名"); assert.equal(invalid.validation.valid, false);
  assert.deepEqual(invalid.validation.issues, ["fixture missing asset"]);
  assert.equal(invalid.visualInspectionPerformed, false);
  console.log("PASS inspect reads back rename and exposes validation failure without claiming visual acceptance");

  const counts = [fixture.previews, fixture.validations];
  await assert.rejects(inspect({ ...principal, tenantId: 8 }), { code: "REPORT_NOT_FOUND" });
  assert.deepEqual([fixture.previews, fixture.validations], counts);
  const reads = fixture.reads;
  await assert.rejects(inspect({ ...principal, scopes: [] }), { code: "FORBIDDEN" });
  assert.equal(fixture.reads, reads);
  fixture.locked = true;
  await assert.rejects(invokeStudioTool(principal, "rename_report", { ...renameArgs, operationId: "rename_fixture_002" }, "https://example.invalid"), { code: "EDIT_LOCK_REQUIRED" });
  fixture.locked = false;
  await assert.rejects(invokeStudioTool({ ...principal, tenantId: 8 }, "rename_report", { ...renameArgs, operationId: "rename_other_tenant" }, "https://example.invalid"), { code: "REPORT_NOT_FOUND" });
  assert.equal(fixture.writes, 1);
  console.log("PASS tenant/scope isolation and edit lock prevent unauthorized reads, previews, and renames");
} finally {
  await rm(dir, { recursive: true, force: true });
  delete globalThis.reportWorkflowFixture;
}
