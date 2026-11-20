/** Real service integration with a disposable SQLite DB, Git workspace and key.
 * Run under Node >=22.5 (.nvmrc): node_modules/.bin/tsx --tsconfig tsconfig.json scripts/verify-report-workflow-isolated.ts
 * No production configuration, HTTP server, browser or model is used.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results: string[] = [];
const resultPath = process.env.REPORT_WORKFLOW_RESULT_PATH;
function check(condition: unknown, label: string) {
  assert.ok(condition, label); results.push(label); console.log(`PASS ${label}`);
}

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  assert.ok(major > 22 || (major === 22 && minor >= 5), "This SQLite selfcheck requires Node >=22.5; use the project's .nvmrc runtime");
  const temporary = await fs.mkdtemp(path.join(tmpdir(), "studio-workbuddy-selfcheck-"));
  const previousCwd = process.cwd();
  const envKeys = ["STUDIO_CONFIG_PATH", "STUDIO_WORKBUDDY_CONFIG_PATH", "WORKSPACE_STORAGE_ROOT", "AUTO_INIT_DATABASE", "AUTO_START_AGENT_RUNTIME"] as const;
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  let pool: { end(): Promise<void> } | undefined;
  let succeeded = false;
  try {
    const configPath = path.join(temporary, "studio.json");
    const databasePath = path.join(temporary, "studio.sqlite");
    const workspace = path.join(temporary, "workspace");
    await fs.writeFile(configPath, JSON.stringify({
      database: { url: `sqlite:${databasePath}` }, reportEditLock: { enabled: true }, resourceCenter: { enabled: false },
    }));
    process.env.STUDIO_CONFIG_PATH = configPath;
    process.env.STUDIO_WORKBUDDY_CONFIG_PATH = configPath;
    process.env.WORKSPACE_STORAGE_ROOT = workspace;
    process.env.AUTO_INIT_DATABASE = "true";
    process.env.AUTO_START_AGENT_RUNTIME = "false";
    // CWD isolation also prevents legacy .runtime migration from the real checkout.
    await fs.cp(path.join(project, "templates/_blank/working"), path.join(temporary, "templates/_blank/working"), { recursive: true });
    process.chdir(temporary);
    globalThis.fetch = async () => { throw new Error("Network fetch forbidden in isolated report selfcheck"); };

    const { getDatabaseConfig } = await import("../lib/server/database-config");
    const config = getDatabaseConfig();
    assert.equal(config.kind, "sqlite");
    if (config.kind !== "sqlite") throw new Error("SQLite isolation required");
    assert.equal(config.path, databasePath);
    const storage = await import("../lib/server/workspace-storage");
    assert.equal(storage.WORKSPACE_STORAGE_ROOT, workspace);
    const { ensureDatabaseBootstrap } = await import("../lib/server/database-bootstrap");
    const { getDbPool } = await import("../lib/server/mysql");
    const db = getDbPool(); pool = db;
    await ensureDatabaseBootstrap();
    check(true, "isolated SQLite, CWD and workspace initialized before service imports");

    const { createApiKey, authenticateApiRequest } = await import("../lib/server/open-api-auth");
    const { invokeStudioTool } = await import("../lib/server/open-api-tools");
    const { acquireReportEditLock, releaseReportEditLock } = await import("../lib/server/report-edit-lock");
    const { redeemPreviewTicket } = await import("../lib/server/studio-preview");
    const [users] = await db.query<any[]>("SELECT id,tenant_id,username,name FROM tenant_user WHERE username='admin'");
    assert.ok(users[0]);
    const user = users[0];
    const owner = { tenantId: Number(user.tenant_id), userId: Number(user.id), username: user.username, name: user.name, role: "administrator" as const };
    const key = await createApiKey(owner, { name: "disposable-selfcheck" });
    const principal = await authenticateApiRequest(new Request("http://127.0.0.1", { headers: { Authorization: `Bearer ${key.secret}` } }));
    check(principal.userId === owner.userId && principal.tenantId === owner.tenantId, "real API-key authentication uses only disposable database");
    const call = (name: string, args: Record<string, unknown>) => invokeStudioTool(principal, name, args, "http://127.0.0.1:1") as Promise<any>;
    const context = await call("get_studio_context", {});
    assert.ok(context.folders.length);
    check(context.workflowContract.requiresSkill === false && context.workflowContract.version === "2026-11-18.local-preview.2", "MCP context carries versioned skill-independent workflow");
    const { POST } = await import("../app/api/mcp/route");
    const rpc = async (method: string, params: object) => {
      const response = await POST(new Request("http://127.0.0.1/api/mcp", { method: "POST", headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
      assert.equal(response.status, 200);
      return response.json() as Promise<any>;
    };
    const initialized = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "isolated-mcp-selfcheck", version: "1" } });
    assert.equal(initialized.result.serverInfo.version, "0.5.1");
    assert.match(initialized.result.instructions, /无需安装、查找或加载任何 Skill/);
    assert.match(initialized.result.instructions, /可见原生终端前台运行serve/);
    assert.match(initialized.result.instructions, /不得清除NODE_OPTIONS/);
    assert.match(initialized.result.instructions, /模拟数据分支不适用/);
    const discovered = await rpc("tools/list", {});
    assert.ok(discovered.result.tools.find((t: any) => t.name === "apply_report_changes").inputSchema.properties.expectedReportName);
    for (const toolName of ["begin_report_development", "inspect_report_development", "commit_report_development", "close_report_development"]) {
      assert.ok(discovered.result.tools.find((t: any) => t.name === toolName), toolName);
    }
    const wireContext = await rpc("tools/call", { name: "get_studio_context", arguments: {} });
    assert.equal(wireContext.result.structuredContent.workflowContract.requiresSkill, false);
    assert.equal(wireContext.result.structuredContent.fileDevelopmentContract.mode, "local-edit-local-dynamic-preview-explicit-upload");
    check(true, "real MCP initialize, tools/list and tools/call expose standalone contract and new name guard without a Skill");
    const folderId = Number(context.folders[0].id);
    await assert.rejects(call("create_report", { folderId: 99999999, name: "invalid-folder", operationId: "invalid_folder_001" }), { code: "FOLDER_NOT_FOUND" });
    check(true, "missing target folder is rejected without guessing a replacement");

    const createArgs = { folderId, name: "流程自检初稿", operationId: "create_selfcheck_001" };
    const created = await call("create_report", createArgs);
    const reportCode = created.report.code;
    assert.ok(created.baseCommitHash);
    assert.equal((await call("create_report", createArgs)).report.code, reportCode);
    await assert.rejects(call("create_report", { ...createArgs, name: "different" }), { code: "IDEMPOTENCY_CONFLICT" });
    check(true, "create initializes Git and idempotent replay never duplicates a report");

    const initial = await call("read_report", { reportCode });
    const data = { period: "2026-01", revenueYuan: 1000, orders: 10, averageOrderYuan: 100 };
    assert.equal(data.revenueYuan / data.orders, data.averageOrderYuan);
    const page = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>流程自检初稿</title></head><body><h1>流程自检初稿</h1><p>模拟数据，仅供流程验证；统计期 2026-01</p><section>营业额 1000 元；订单数 10 单；客单价 100 元/单</section><svg role="img" aria-label="模拟营业额趋势" viewBox="0 0 100 40"><path d="M0 35 L50 20 L100 5" stroke="blue" fill="none"/></svg></body></html>`;
    const saved = await call("apply_report_changes", {
      reportCode, baseCommitHash: initial.baseCommitHash, operationId: "save_selfcheck_001", message: "新增模拟报表自检",
      files: { "page.html": page, "app.js": "(() => { /* static selfcheck */ })();\n", "data/monthly.json": JSON.stringify(data) },
    });
    check(saved.saved === true && saved.validation.valid === true && saved.commitHash !== initial.baseCommitHash, "first save validates real files and creates a new Git revision");
    const beforeRename = await call("read_report", { reportCode, files: ["report.json", "page.html", "styles.css", "server.js", "app.js", "data/monthly.json"] });
    assert.equal(beforeRename.files["styles.css"], initial.files["styles.css"]);
    assert.equal(beforeRename.files["server.js"], initial.files["server.js"]);
    check(true, "initial content save preserves unrelated style and runtime files");

    const target = "流程自检新增与编辑完成";
    const renameArgs = { reportCode, name: target, operationId: "rename_selfcheck_001" };
    const renamed = await call("rename_report", renameArgs);
    assert.equal(renamed.report.name, target);
    assert.equal((await call("rename_report", renameArgs)).report.name, target);
    const partial = await call("read_report", { reportCode });
    assert.equal(partial.baseCommitHash, saved.commitHash);
    assert.equal(partial.files["page.html"], page);
    check(true, "rename changes metadata but not source or Git revision; partial state remains detectable");

    const partialInspect = await call("inspect_report", { reportCode });
    assert.equal(partialInspect.nameConsistency.status, "mismatch");
    assert.equal(partialInspect.acceptance.visual, "not_checked");
    assert.equal(partialInspect.acceptance.requirements, "not_checked");
    check(true, "inspect detects partial rename without confusing structural, requirement or visual checks");
    await assert.rejects(call("apply_report_changes", { reportCode, baseCommitHash: partial.baseCommitHash, expectedReportName: "stale-name", operationId: "stale_name_guard_001", message: "must not write", files: { "page.html": "should never be written" } }), { code: "REPORT_NAME_CONFLICT" });
    const afterNameConflict = await call("read_report", { reportCode, files: ["page.html"] });
    assert.equal(afterNameConflict.baseCommitHash, partial.baseCommitHash);
    assert.equal(afterNameConflict.files["page.html"], page);
    check(true, "metadata-name concurrency guard rejects before writing files or Git history");
    const manifest = JSON.parse(partial.files["report.json"]);
    assert.ok(Object.hasOwn(manifest, "name")); manifest.name = target;
    const editArgs = { reportCode, baseCommitHash: partial.baseCommitHash, operationId: "edit_selfcheck_001", expectedReportName: target, message: "同步标题与口径说明", files: {
      "report.json": JSON.stringify(manifest, null, 2),
      "page.html": page.replaceAll("流程自检初稿", target).replace("</body>", "<section><h2>模拟数据口径说明</h2><p>客单价=营业额（元）/订单数；统计期 2026-01。</p></section></body>"),
      "description.md": "# 模拟数据口径说明\n2026-01，营业额1000元，10单，客单价100元/单。无真实业务查询。\n",
    } };
    const edited = await call("apply_report_changes", editArgs);
    assert.equal(edited.saved, true); assert.equal(edited.validation.valid, true);
    assert.deepEqual(edited.acceptance, { structure: "passed", requirements: "not_checked", visual: "not_checked" });
    const aligned = await call("inspect_report", { reportCode });
    assert.equal(aligned.nameConsistency.status, "passed");
    assert.equal(aligned.nameConsistency.pageTitle, "not_checked");
    check(true, "save and inspect expose bounded acceptance, aligned names and no invented DOM check");
    assert.equal((await call("apply_report_changes", editArgs)).commitHash, edited.commitHash);
    check(true, "second save and replay produce one logical edit on the same report");
    const after = await call("read_report", { reportCode, files: Object.keys(beforeRename.files) });
    assert.equal(after.report.code, reportCode); assert.equal(after.report.name, target);
    assert.equal(JSON.parse(after.files["report.json"]).name, target);
    assert.ok(after.files["page.html"].includes(`<title>${target}</title>`) && after.files["page.html"].includes(`<h1>${target}</h1>`));
    assert.ok(after.files["page.html"].includes("模拟数据口径说明"));
    for (const file of ["styles.css", "server.js", "app.js", "data/monthly.json"]) assert.equal(after.files[file], beforeRename.files[file], file);
    check(true, "metadata, manifest and page titles agree; metrics, period, styles and runtime are byte-preserved");

    await assert.rejects(call("apply_report_changes", { ...editArgs, operationId: "stale_selfcheck_001" }), { code: "WORKING_BASE_CONFLICT" });
    check(true, "stale base revision is rejected rather than overwriting newer work");
    await assert.rejects(call("apply_report_changes", { ...editArgs, operationId: "invalid_selfcheck_001", baseCommitHash: after.baseCommitHash, files: { "app.js": "" } }), { code: "REPORT_VALIDATION_FAILED" });
    const restored = await call("read_report", { reportCode, files: ["app.js"] });
    assert.equal(restored.baseCommitHash, after.baseCommitHash); assert.equal(restored.files["app.js"], after.files["app.js"]);
    assert.equal(restored.report.name, target);
    check(true, "failed source validation restores prior files/revision without losing successful metadata rename");

    const lock = await acquireReportEditLock({ ...owner, reportCode }); assert.ok(lock);
    try {
      await assert.rejects(call("rename_report", { reportCode, name: "should-not-save", operationId: "locked_selfcheck_001" }), { code: "EDIT_LOCK_REQUIRED" });
    } finally { await releaseReportEditLock(owner.tenantId, reportCode, lock.lockToken); }
    check(true, "actual database edit lock blocks concurrent rename");
    await assert.rejects(invokeStudioTool({ ...principal, tenantId: 999999 }, "inspect_report", { reportCode }, "http://127.0.0.1:1"), { code: "REPORT_NOT_FOUND" });
    check(true, "other tenant cannot inspect report metadata or receive its preview link");
    const inspected = await call("inspect_report", { reportCode });
    assert.equal(inspected.report.name, target); assert.equal(inspected.report.code, reportCode);
    assert.equal(inspected.commitHash, after.baseCommitHash); assert.equal(inspected.validation.valid, true);
    assert.equal(inspected.visualInspectionPerformed, false);
    check(true, "inspect returns real metadata/version/validation without claiming visual acceptance");
    const ticket = new URLSearchParams(new URL(inspected.previewUrl).hash.slice(1)).get("ticket"); assert.ok(ticket);
    assert.equal((await redeemPreviewTicket(ticket)).reportCode, reportCode);
    await assert.rejects(redeemPreviewTicket(ticket), { code: "PREVIEW_EXPIRED" });
    check(true, "real preview ticket is report-scoped and one-use; no browser is opened");
    const sharing = await call("get_report_public_link", { reportCode });
    assert.equal(sharing.enabled, false);
    const [rows] = await db.query<any[]>("SELECT status,release_status FROM tenant_report WHERE tenant_id=? AND code=?", [owner.tenantId, reportCode]);
    assert.notEqual(rows[0].status, "已发布"); assert.notEqual(rows[0].release_status, "已发布");
    check(true, "all operations leave the report unpublished and public sharing disabled");
    const { verifyFileDevelopment } = await import("./verify-report-file-development");
    await verifyFileDevelopment(principal, reportCode, temporary, check);
    succeeded = true;
  } finally {
    try { await pool?.end(); } finally {
      globalThis.fetch = previousFetch;
      process.chdir(previousCwd);
      for (const key of envKeys) {
        if (previousEnv[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[key];
      }
      await fs.rm(temporary, { recursive: true, force: true });
      if (resultPath) await fs.writeFile(resultPath, JSON.stringify({
        status: succeeded ? "passed" : "failed", checks: results, count: results.length,
        isolation: "disposable SQLite + Git workspace + CWD + API key; fetch disabled; temporary directory removed",
        notCovered: ["production network transport (loopback file transfer and real HTTP handlers are exercised)", "WorkBuddy model behavior", "browser visual acceptance", "production deployment"],
      }, null, 2) + "\n");
    }
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "selfcheck failed"); process.exitCode = 1; });
