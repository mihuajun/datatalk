/** Invoked inside verify-report-workflow-isolated.ts's disposable DB/workspace. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ApiPrincipal } from "../lib/server/open-api-auth";

export async function verifyFileDevelopment(principal: ApiPrincipal, reportCode: string, temporary: string, check: (ok: unknown, message: string) => void) {
  const { invokeStudioTool } = await import("../lib/server/open-api-tools");
  const { getDbPool } = await import("../lib/server/mysql");
  const { createDataSource } = await import("../lib/server/data-source-repository");
  const { DatabaseSync } = await import("node:sqlite");
  const { createServer } = await import("node:http");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { fileURLToPath } = await import("node:url");
  const dbFile = path.join(temporary, "business-fixture.sqlite");
  const business = new DatabaseSync(dbFile);
  business.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY, amount REAL, status TEXT); INSERT INTO orders VALUES(1,120,'paid'),(2,80,'paid'),(3,99,'cancelled')"); business.close();
  await createDataSource({ tenantId: principal.tenantId, name: "dev_fixture", type: "SQLite", host: dbFile, port: null, database: "business", username: "", password: "", owner: "selfcheck" });
  const call = (name: string, args: object) => invokeStudioTool(principal, name, args, "http://127.0.0.1") as Promise<any>;
  const transfer = await import("../app/api/open/report-development/[tenant]/[code]/[session]/route");
  const preview = await import("../app/api/open/report-development/[tenant]/[code]/[session]/preview/route");
  const { getReportWorkspacePath, resolveReportSourcePath } = await import("../lib/server/report-workspace");
  const { withReportDevelopmentRoot } = await import("../lib/server/report-development-context");
  const { assertDevelopmentPath, decodeDevelopmentFile } = await import("../lib/server/report-development");
  const original = await call("read_report", { reportCode });
  const bytes: Record<string, string> = {
    "description.md": "# 原样文件提交\r\n中文与 CRLF 保留。\r\n",
    "server.js": `module.exports={handlers:{orders:async c=>c.query('dev_fixture',"SELECT COUNT(*) AS n,SUM(amount) AS amount FROM orders WHERE status=:status",{status:c.filters.status||'paid'})}};\n`,
    "report.json": JSON.stringify({ ...JSON.parse(original.files["report.json"]), filters: [{ key: "status", type: "select", defaultValue: "paid" }] }),
  };
  const files = Object.entries(bytes).map(([path, content]) => ({ path, size: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") }));
  const args = { reportCode, baseCommitHash: original.baseCommitHash, files, operationId: "file_development_begin_01" };
  const session = await call("begin_report_development", args);
  assert.equal((await call("begin_report_development", args)).sessionId, session.sessionId);
  const ctx = { params: Promise.resolve({ tenant: String(principal.tenantId), code: reportCode, session: session.sessionId }) };
  const url = (file: string) => `${session.transfer.endpoint}?path=${encodeURIComponent(file)}`;
  const headers = { Authorization: session.transfer.authorization };
  const missing = await transfer.GET(new Request(url("page.html")), ctx); assert.equal(missing.status, 401);
  const downloaded = await transfer.GET(new Request(url("page.html"), { headers }), ctx);
  assert.equal(downloaded.status, 200); assert.equal(await downloaded.text(), original.files["page.html"]);
  assert.equal((await call("read_report", { reportCode })).baseCommitHash, original.baseCommitHash);
  check(true, "development begin/replay and raw baseline download are authenticated and do not modify the report");
  await assert.rejects(call("inspect_report_development", { reportCode, sessionId: session.sessionId }), { code: "UPLOAD_INCOMPLETE" });
  await assert.rejects(invokeStudioTool({ ...principal, userId: principal.userId + 1 }, "inspect_report_development", { reportCode, sessionId: session.sessionId }, "http://127.0.0.1"), { code: "DEVELOPMENT_NOT_FOUND" });
  const wrongTenant = await transfer.GET(new Request(url("page.html"), { headers }), { params: Promise.resolve({ tenant: "999999", code: reportCode, session: session.sessionId }) }); assert.equal(wrongTenant.status, 404);
  check(true, "incomplete uploads, other users and other tenants cannot access development previews");
  for (const name of ["../server.js", "assets/../server.js", "assets\\x.js", ".env", "data/secret.xlsx", "assets//x.js"]) assert.throws(() => assertDevelopmentPath(name));
  assert.throws(() => decodeDevelopmentFile(Buffer.from([0xff, 0xfe])));
  const badHash = await transfer.PUT(new Request(url("description.md"), { method: "PUT", headers, body: "wrong" }), ctx); assert.equal(badHash.status, 422);
  const huge = await transfer.PUT(new Request(url("description.md"), { method: "PUT", headers, body: "x".repeat(1000) }), ctx); assert.equal(huge.status, 413);
  const extra = await transfer.PUT(new Request(url("app.js"), { method: "PUT", headers, body: "x" }), ctx); assert.equal(extra.status, 400);
  const crossOrigin = await transfer.GET(new Request(url("page.html"), { headers: { ...headers, Origin: "https://unrelated.invalid" } }), ctx); assert.equal(crossOrigin.status, 403);
  check(true, "transfer rejects traversal, binary encoding, hash mismatch, oversized streams, undeclared files and cross-origin access");
  for (const [file, content] of Object.entries(bytes)) {
    for (let retry = 0; retry < 2; retry++) assert.equal((await transfer.PUT(new Request(url(file), { method: "PUT", headers, body: content }), ctx)).status, 200);
  }
  // Exercise the actual standalone helper over a loopback HTTP socket, not only direct route calls.
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const incoming = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, ...(req.method === "PUT" ? { body: Buffer.concat(chunks) } : {}) });
      const response = req.method === "PUT" ? await transfer.PUT(incoming, ctx) : await transfer.GET(incoming, ctx);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end("fixture failure"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const config = { ...session, transfer: { ...session.transfer, endpoint: session.transfer.endpoint.replace("http://127.0.0.1", `http://127.0.0.1:${port}`) } };
    const configPath = path.join(temporary, "transfer.credentials.json"); await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const cli = fileURLToPath(new URL("./studio-report-files.mjs", import.meta.url));
    const local = path.join(temporary, "local-report");
    const runCli = (...args: string[]) => promisify(execFile)(process.execPath, [cli, ...args], { timeout: 30000 });
    const pulled = await runCli("pull", configPath, local); assert.ok(!pulled.stdout.includes(session.transfer.authorization));
    for (const [name, content] of Object.entries(bytes)) await fs.writeFile(path.join(local, name), content);
    const manifest = JSON.parse((await runCli("manifest", local, ...Object.keys(bytes))).stdout); assert.deepEqual(manifest.files, files);
    await runCli("push", configPath, local);
    await fs.appendFile(path.join(local, "description.md"), "changed");
    await assert.rejects(runCli("push", configPath, local));
    await assert.rejects(runCli("pull", configPath, local));
    check(true, "native file helper performs real loopback HTTP download/upload and manifest hashing, rejects changed source and refuses to overwrite local edits");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  const inspected = await call("inspect_report_development", { reportCode, sessionId: session.sessionId });
  assert.equal(inspected.validation.valid, true); assert.equal(inspected.saved, false); assert.equal(inspected.acceptance.data, "not_checked");
  const previewToken = new URLSearchParams(new URL(inspected.previewUrl).hash.slice(1)).get("token")!;
  const previewHeaders = { Authorization: `Bearer ${previewToken}`, "Content-Type": "application/json" };
  const previewRequest = (body: object) => new Request(inspected.previewUrl.split('#')[0], { method: "POST", headers: previewHeaders, body: JSON.stringify(body) });
  const html = await preview.POST(previewRequest({}), ctx); assert.equal(html.status, 200); assert.match((await html.json()).srcdoc, /reportRuntime/);
  const query = await preview.POST(previewRequest({ dataId: "orders", filters: { status: "paid" } }), ctx); assert.equal(query.status, 200); assert.deepEqual((await query.json()).data, [{ n: 2, amount: 200 }]);
  const cancelled = await preview.POST(previewRequest({ dataId: "orders", filters: { status: "cancelled" } }), ctx); assert.deepEqual((await cancelled.json()).data, [{ n: 1, amount: 99 }]);
  assert.equal((await call("read_report", { reportCode })).files["server.js"], original.files["server.js"]);
  assert.equal((await transfer.PUT(new Request(url("description.md"), { method: "PUT", headers: previewHeaders, body: bytes["description.md"] }), ctx)).status, 401);
  check(true, "isolated cloud preview executes uploaded handler against disposable SQL data (paid 200, cancelled 99), without changing live source; preview token cannot upload");
  const ordinaryPath = resolveReportSourcePath(principal.tenantId, reportCode, "server.js");
  await Promise.all([withReportDevelopmentRoot(principal.tenantId, reportCode, "/test-only-root", async () => { await new Promise(r => setTimeout(r, 1)); assert.equal(resolveReportSourcePath(principal.tenantId, reportCode, "server.js"), "/test-only-root/server.js"); }), (async () => { assert.equal(resolveReportSourcePath(principal.tenantId, reportCode, "server.js"), ordinaryPath); })()]);
  check(true, "development runtime path override is request-local and cannot leak to concurrent normal report requests");
  const commitArgs = { reportCode, sessionId: session.sessionId, operationId: "file_development_commit_01", message: "提交原始文件", expectedReportName: original.report.name };
  const committed = await call("commit_report_development", commitArgs); assert.equal(committed.saved, true);
  const final = await call("read_report", { reportCode });
  for (const [file, content] of Object.entries(bytes)) assert.equal(final.files[file], content, file);
  for (const file of ["page.html", "styles.css", "app.js"]) assert.equal(final.files[file], original.files[file]);
  assert.equal((await call("commit_report_development", commitArgs)).commitHash, committed.commitHash);
  check(true, "file commit preserves all uploaded bytes including report.json and CRLF, preserves unrelated source, and replays idempotently");
  await assert.rejects(call("commit_report_development", { ...commitArgs, operationId: "file_development_stale_01" }), { code: "WORKING_BASE_CONFLICT" });
  await call("close_report_development", { reportCode, sessionId: session.sessionId });
  assert.equal((await transfer.GET(new Request(url("page.html"), { headers }), ctx)).status, 404);
  assert.equal((await call("commit_report_development", commitArgs)).commitHash, committed.commitHash);
  check(true, "stale upload commits are rejected; closing revokes transfers while committed-operation replay still returns the saved result");
  const bad = await call("begin_report_development", { reportCode, baseCommitHash: final.baseCommitHash, files: [{ path: "app.js", size: 0, sha256: createHash("sha256").update("").digest("hex") }], operationId: "file_development_invalid_01" });
  const badctx = { params: Promise.resolve({ tenant: String(principal.tenantId), code: reportCode, session: bad.sessionId }) };
  await transfer.PUT(new Request(`${bad.transfer.endpoint}?path=app.js`, { method: "PUT", headers: { Authorization: bad.transfer.authorization }, body: "" }), badctx);
  assert.equal((await call("inspect_report_development", { reportCode, sessionId: bad.sessionId })).validation.valid, false);
  await assert.rejects(call("commit_report_development", { reportCode, sessionId: bad.sessionId, operationId: "file_development_invalid_commit", message: "invalid" }), { code: "REPORT_VALIDATION_FAILED" });
  assert.equal((await call("read_report", { reportCode })).baseCommitHash, final.baseCommitHash);
  check(true, "invalid staged source fails inspection and commit with original working tree and revision intact");
  const sessionPath = path.join(getReportWorkspacePath(principal.tenantId, reportCode), ".development", bad.sessionId, "session.json");
  const meta = JSON.parse(await fs.readFile(sessionPath, "utf8")); meta.expiresAt = Date.now() - 1; await fs.writeFile(sessionPath, JSON.stringify(meta));
  assert.equal((await transfer.GET(new Request(`${bad.transfer.endpoint}?path=app.js`, { headers: { Authorization: bad.transfer.authorization } }), badctx)).status, 410);
  check(true, "expired development capabilities are rejected");
  const [reportRows] = await getDbPool().query<any[]>("SELECT status,release_status,public_link_enabled FROM tenant_report WHERE tenant_id=? AND code=?", [principal.tenantId, reportCode]);
  assert.notEqual(reportRows[0].status, "已发布"); assert.notEqual(reportRows[0].release_status, "已发布"); assert.equal(Number(reportRows[0].public_link_enabled), 0);
  check(true, "development upload, preview and commit never publish or enable public sharing");
  const { verifyLocalPreview } = await import("./verify-report-local-preview");
  await verifyLocalPreview(principal, reportCode, temporary, check);
  const latestLocal = await call("read_report", { reportCode });
  const revoke = await call("begin_report_development", { reportCode, baseCommitHash: latestLocal.baseCommitHash, files: [], operationId: "file_development_revoke_01" });
  await getDbPool().execute("DELETE FROM studio_api_key WHERE id=?", [principal.keyId]);
  const revoked = await transfer.GET(new Request(`${revoke.transfer.endpoint}?path=page.html`, { headers: { Authorization: revoke.transfer.authorization } }), { params: Promise.resolve({ tenant: String(principal.tenantId), code: reportCode, session: revoke.sessionId }) }); assert.equal(revoked.status, 401);
  check(true, "revoking the parent API key immediately invalidates its file-transfer capability");
}
