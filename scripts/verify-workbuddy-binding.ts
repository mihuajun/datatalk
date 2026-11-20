import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

async function main() {
  const root = await fs.mkdtemp(path.resolve(".workbuddy-local/binding-test-"));
  process.env.STUDIO_CONFIG_PATH = path.join(root, "studio.yaml");
  process.env.WORKSPACE_STORAGE_ROOT = path.join(root, "workspace");
  process.env.WORKBUDDY_CLIENT_ID = "cb_binding_test";
  process.env.WORKBUDDY_CLIENT_SECRET = "test-only-client-secret";
  delete process.env.WORKBUDDY_CLIENT_SECRET_FILE;
  delete process.env.STUDIO_WORKBUDDY_CONFIG_PATH;
  process.env.WORKBUDDY_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  await fs.writeFile(process.env.STUDIO_CONFIG_PATH, `database:\n  url: "sqlite:${root}/test.sqlite"\n`);
  const { getDatabaseConfig } = await import("../lib/server/database-config");
  const { initializeSqliteDatabase } = await import("../lib/server/sqlite-bootstrap");
  const config = getDatabaseConfig(); assert.equal(config.kind, "sqlite");
  if (config.kind !== "sqlite") throw new Error("Isolated SQLite is required");
  await initializeSqliteDatabase(config);
  const { getDbPool } = await import("../lib/server/mysql");
  const pool = getDbPool();
  const wb = await import("../lib/server/workbuddy-oauth");
  const { normalizeAvatar } = await import("../lib/avatar");
  let checks = 0;
  function check(condition: unknown, label: string) { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); }
  const origin = "http://127.0.0.1:3010";
  const [users] = await pool.query<any[]>("SELECT id,tenant_id FROM tenant_user ORDER BY id");
  const who = { tenantId: Number(users[0].tenant_id), userId: Number(users[0].id) };
  const other = { ...who, userId: Number(users[1].id) };
  let tokenCalls = 0, refreshCalls = 0, profileFails = false, refreshFails = false, badAvatar = false, wrongIdentity = false;
  let avatar = "https://example.com/workbuddy-avatar.png";
  let lastRefresh = "refresh-initial";
  const provider: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    if (url.endsWith("/token")) {
      tokenCalls++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("client_id"), "cb_binding_test"); assert.equal(body.get("client_secret"), "test-only-client-secret");
      if (body.get("grant_type") === "refresh_token") {
        refreshCalls++; assert.equal(body.get("refresh_token"), lastRefresh);
        if (refreshFails) return Response.json({ error: "invalid_grant", error_description: "upstream-private-secret" }, { status: 400 });
        lastRefresh = `refresh-rotated-${refreshCalls}`;
      } else { assert.equal(body.get("redirect_uri"), `${origin}${wb.WORKBUDDY_CALLBACK_PATH}`); lastRefresh = "refresh-initial"; }
      return Response.json({ access_token: "private-access-token", refresh_token: lastRefresh, open_id: wrongIdentity ? "op_different_user" : "op_test", token_type: "Bearer", expires_in: 3600, scope: "user.profile.readable" });
    }
    assert.equal(url, "https://www.workbuddy.cn/openapi/v2/user/profile");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-access-token");
    if (profileFails) return Response.json({ error: "temporary_error", error_description: "upstream-private-secret" }, { status: 503 });
    return Response.json({ nickname: "WorkBuddy 测试用户", avatar: badAvatar ? "javascript:alert(1)" : avatar });
  };
  async function start() {
    const started = await wb.beginWorkBuddyBinding(who, origin);
    return { ...started, params: new URLSearchParams({ state: new URL(started.url).searchParams.get("state")!, code: "test-only-code" }) };
  }
  const finish = (s: Awaited<ReturnType<typeof start>>, identity = who, site = origin, nonce = s.browserNonce) => wb.finishWorkBuddyBinding(identity, site, s.params, nonce, provider);
  async function expectError(run: () => Promise<unknown>, code: string, label: string) {
    await assert.rejects(run, (e: any) => e.code === code && !e.message.includes("private-secret")); check(true, label);
  }
  try {
    // Exercise the additive migration on an existing user table as well as fresh creation.
    await pool.query("ALTER TABLE tenant_user DROP COLUMN avatar");
    await initializeSqliteDatabase(config);
    const [columns] = await pool.query<any[]>("PRAGMA table_info(tenant_user)");
    check(columns.some(c => c.name === "avatar"), "existing SQLite user table gains nullable avatar");
    check(normalizeAvatar("javascript:alert(1)") === null && normalizeAvatar("//evil.example/a.png") === null && normalizeAvatar("/icon.svg") === "/icon.svg", "avatar schemes and protocol-relative URLs are validated");
    check(!(await wb.workBuddyStatus(who)).connected, "unbound status does not imply authorization");
    const pending = await start();
    const authorize = new URL(pending.url);
    check(authorize.origin === "https://www.workbuddy.cn" && authorize.searchParams.get("scope") === "user.profile.readable" && !authorize.searchParams.has("client_secret"), "authorization URL uses official host and explicit profile-only scope without secret");
    await expectError(() => finish(pending, other), "invalid_state", "callback cannot bind to another Studio user");
    await expectError(() => finish(pending, { ...who, tenantId: who.tenantId + 1 }), "invalid_state", "callback cannot cross workspaces");
    await expectError(() => finish(pending, who, "https://other.example"), "invalid_state", "callback is bound to its exact Studio origin");
    await expectError(() => finish(pending, who, origin, randomBytes(32).toString("base64url")), "invalid_state", "callback requires initiating browser nonce");
    check(tokenCalls === 0, "rejected state never sends authorization code to provider");
    await finish(pending);
    await expectError(() => finish(pending), "invalid_state", "authorization callback is single use");
    check(tokenCalls === 1, "authorization code exchanged exactly once");
    const [bindings] = await pool.query<any[]>("SELECT * FROM studio_workbuddy_binding");
    check(bindings.length === 1 && !JSON.stringify(bindings).includes("private-access-token") && !JSON.stringify(bindings).includes("refresh-initial"), "WorkBuddy tokens encrypted at rest separately from Studio API keys");
    const status = await wb.workBuddyStatus(who);
    check(status.connected && !JSON.stringify(status).includes("token") && !(await wb.workBuddyStatus(other)).connected, "status hides credentials and isolates users");
    const profile = await wb.readWorkBuddyProfile(who, provider);
    const [saved] = await pool.query<any[]>("SELECT avatar,name FROM tenant_user WHERE id=?", [who.userId]);
    check(profile.nickname === "WorkBuddy 测试用户" && saved[0].avatar === avatar && saved[0].name !== profile.nickname, "profile sync persists avatar without replacing Studio name");
    badAvatar = true; await wb.readWorkBuddyProfile(who, provider); badAvatar = false;
    const [afterBad] = await pool.query<any[]>("SELECT avatar FROM tenant_user WHERE id=?", [who.userId]);
    check(afterBad[0].avatar === avatar, "invalid upstream avatar does not overwrite existing user image");
    await pool.query("UPDATE studio_workbuddy_binding SET expires_at=0");
    await Promise.all([wb.readWorkBuddyProfile(who, provider), wb.readWorkBuddyProfile(who, provider)]);
    check(refreshCalls === 1, "concurrent profile requests rotate refresh token only once");
    await pool.query("UPDATE studio_workbuddy_binding SET expires_at=0"); profileFails = true;
    await expectError(() => wb.readWorkBuddyProfile(who, provider), "provider_unavailable", "upstream outage returns sanitized error");
    profileFails = false; await wb.readWorkBuddyProfile(who, provider);
    check(refreshCalls === 2, "rotated token survives subsequent profile outage");
    await pool.query("UPDATE studio_workbuddy_binding SET expires_at=0"); wrongIdentity = true;
    await expectError(() => wb.readWorkBuddyProfile(who, provider), "invalid_token_response", "refresh cannot switch WorkBuddy identity");
    check((await wb.workBuddyStatus(who)).needsReauth, "unusable rotated response requires reauthorization");
    wrongIdentity = false; await finish(await start());
    await pool.query("UPDATE studio_workbuddy_binding SET expires_at=0"); refreshFails = true;
    await expectError(() => wb.readWorkBuddyProfile(who, provider), "reconnect_required", "expired refresh grant requires reauthorization");
    check((await wb.workBuddyStatus(who)).needsReauth, "expired binding exposes reconnect state");
    refreshFails = false;
    const cancelled = await start(); cancelled.params.delete("code"); cancelled.params.set("error", "access_denied");
    await expectError(() => finish(cancelled), "access_denied", "user cancellation is handled without exchanging token");
    await expectError(() => finish(cancelled), "invalid_state", "denied state cannot be replayed");
    const expired = await start(); await pool.query("UPDATE studio_workbuddy_request SET expires_at=0");
    await expectError(() => finish(expired), "invalid_state", "expired authorization state is rejected");
    const duplicate = await start(); duplicate.params.append("code", "extra");
    await expectError(() => finish(duplicate), "invalid_request", "duplicate callback parameters are rejected");
    const waiting = await start(); await wb.disconnectWorkBuddy(other);
    check((await wb.workBuddyStatus(who)).needsReauth, "another user cannot remove the binding");
    await wb.disconnectWorkBuddy(who);
    check(!(await wb.workBuddyStatus(who)).connected && !(await wb.workBuddyStatus(who)).needsReauth, "unbinding removes stored credentials");
    await expectError(() => finish(waiting), "invalid_state", "unbinding also invalidates pending callbacks");
    delete process.env.WORKBUDDY_CLIENT_SECRET;
    check(!(await wb.workBuddyStatus(who)).configured, "missing app credentials disable binding explicitly");
    delete process.env.WORKBUDDY_CLIENT_ID;
    await fs.appendFile(process.env.STUDIO_CONFIG_PATH!, 'auth:\n  workbuddy:\n    clientId: cb_binding_test\n    clientSecret: test-only-client-secret\n');
    check((await wb.workBuddyStatus(who)).configured, "YAML credentials enable binding without environment credentials");
    await finish(await start());
    check((await wb.workBuddyStatus(who)).connected, "YAML credentials complete server-side token exchange");
    await wb.disconnectWorkBuddy(who);
    const credentialsConfig = path.join(root, "credentials.yaml");
    await fs.writeFile(credentialsConfig, 'database:\n  url: mysql://must-not-be-used\nauth:\n  workbuddy:\n    clientId: cb_binding_test\n    clientSecret: test-only-client-secret\n');
    process.env.STUDIO_WORKBUDDY_CONFIG_PATH = credentialsConfig;
    await fs.writeFile(process.env.STUDIO_CONFIG_PATH!, `database:\n  url: "sqlite:${root}/test.sqlite"\n`);
    await finish(await start());
    check((await wb.workBuddyStatus(who)).connected && getDatabaseConfig().kind === "sqlite", "dedicated credentials config preserves isolated database and completes token exchange");
    await wb.disconnectWorkBuddy(who);
    check(!(await wb.workBuddyStatus(who)).connected, "disconnect uses YAML client ID without environment credentials");
    console.log(`\n${checks} WorkBuddy binding/avatar checks passed (isolated SQLite and mock provider).`);
  } finally { await pool.end(); await fs.rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
