import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

async function main() {
  const root = await fs.mkdtemp(path.resolve(".workbuddy-local/workbuddy-login-"));
  const configPath = path.join(root, "studio.yaml");
  const config = `database:\n  url: "sqlite:${root}/test.sqlite"\nauth:\n  allowRegistration: true\n  workbuddy:\n    clientId: cb_login_test\n    clientSecret: test-only-secret\n`;
  await fs.writeFile(configPath, config);
  Object.assign(process.env, { STUDIO_CONFIG_PATH: configPath, WORKSPACE_STORAGE_ROOT: path.join(root, "workspace"), WORKBUDDY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex") });
  for (const key of ["WORKBUDDY_CLIENT_ID", "WORKBUDDY_CLIENT_SECRET", "WORKBUDDY_CLIENT_SECRET_FILE", "STUDIO_WORKBUDDY_CONFIG_PATH"]) delete process.env[key];
  const { getDatabaseConfig } = await import("../lib/server/database-config");
  const { initializeSqliteDatabase } = await import("../lib/server/sqlite-bootstrap");
  const db = getDatabaseConfig(); if (db.kind !== "sqlite") throw new Error("Isolated SQLite required");
  await initializeSqliteDatabase(db);
  const { getDbPool } = await import("../lib/server/mysql");
  const pool = getDbPool();
  const wb = await import("../lib/server/workbuddy-oauth");
  const origin = "http://127.0.0.1:3010", next = "/oauth/authorize?client_id=preserved&state=original";
  let checks = 0, tokenCalls = 0, openId = "op_new", profileFails = false;
  let nickname = "相同昵称", avatar = "https://example.com/avatar.png";
  const provider: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, "error");
    if (String(input).endsWith("/token")) {
      tokenCalls++;
      return Response.json({ access_token: "secret-test-token", refresh_token: "secret-test-refresh", token_type: "Bearer", open_id: openId, expires_in: 3600, scope: "user.profile.readable" });
    }
    assert.equal(String(input), "https://www.workbuddy.cn/openapi/v2/user/profile");
    if (profileFails) return Response.json({ error: "temporary_failure" }, { status: 503 });
    return Response.json({ nickname, avatar });
  };
  function check(value: unknown, label: string) { assert.ok(value, label); checks++; console.log(`PASS ${label}`); }
  async function expectError(run: () => Promise<unknown>, code: string, label: string) {
    await assert.rejects(run, (e: any) => e.code === code && !String(e).includes("secret-test")); check(true, label);
  }
  async function start(returnTo = next) {
    const result = await wb.beginWorkBuddyLogin(origin, returnTo);
    return { ...result, params: new URLSearchParams({ state: new URL(result.url).searchParams.get("state")!, code: "code-test-only" }) };
  }
  const finish = (s: Awaited<ReturnType<typeof start>>, nonce = s.browserNonce, site = origin) => wb.finishWorkBuddyLogin(site, s.params, nonce, provider);
  async function counts() {
    const [u] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM tenant_user");
    const [t] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM tenant");
    return [Number(u[0].n), Number(t[0].n)];
  }
  try {
    check(wb.isWorkBuddyLoginConfigured(), "YAML enables WorkBuddy login without additional credentials");
    check(["/\t/evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"].every(value => wb.workBuddyReturnTo(value) === "/reports"), "return targets reject parser-normalized cross-origin URLs");
    const pending = await start();
    const url = new URL(pending.url);
    check(url.origin === "https://www.workbuddy.cn" && url.searchParams.get("redirect_uri") === `${origin}${wb.WORKBUDDY_CALLBACK_PATH}` && url.searchParams.get("scope") === "user.profile.readable", "login reuses registered callback and minimal profile authorization");
    await expectError(() => finish(pending, randomBytes(32).toString("base64url")), "invalid_state", "different browser cannot complete login");
    await expectError(() => finish(pending, pending.browserNonce, "https://other.example"), "invalid_state", "callback must match initiating Studio origin");
    const dup = new URLSearchParams(pending.params); dup.append("state", "another");
    await expectError(() => wb.finishWorkBuddyLogin(origin, dup, pending.browserNonce, provider), "invalid_request", "duplicate callback parameters rejected");
    check(tokenCalls === 0, "invalid callbacks never contact provider");
    const before = await counts();
    const first = await finish(pending);
    check(first.returnTo === next && first.user.role === "developer" && first.user.name === nickname && first.user.avatar === avatar, "first login restores next and returns non-admin Studio session with profile");
    assert.deepEqual(await counts(), before.map(n => n + 1)); check(true, "first login creates exactly one account and personal workspace");
    const [identity] = await pool.query<any[]>("SELECT * FROM user_identity WHERE user_id=?", [first.user.userId]);
    check(identity.length === 1 && identity[0].provider === "workbuddy" && /^[a-f0-9]{64}$/.test(identity[0].provider_key), "identity uses unique application-and-open-id digest");
    const [binding] = await pool.query<any[]>("SELECT * FROM studio_workbuddy_binding WHERE user_id=?", [first.user.userId]);
    check(binding.length === 1 && !JSON.stringify(binding).includes("secret-test"), "login saves encrypted binding for later profile access");
    await expectError(() => finish(pending), "invalid_state", "successful login callback cannot be replayed");
    const afterFirst = await counts();
    const parallel = await Promise.all([start(), start()]);
    const repeated = await Promise.all(parallel.map(s => finish(s)));
    check(repeated.every(r => r.user.userId === first.user.userId), "concurrent logins reuse one account");
    assert.deepEqual(await counts(), afterFirst); check(true, "repeated login creates no orphan spaces");
    await expectError(() => wb.disconnectWorkBuddy(first.user), "last_login_method", "sole WorkBuddy login method cannot be removed");
    check((await wb.workBuddyStatus(first.user)).connected, "rejected unbind preserves credentials and identity");
    await pool.execute("UPDATE tenant_user SET status=0 WHERE id=?", [first.user.userId]);
    await expectError(async () => finish(await start()), "account_disabled", "disabled user cannot log in or create replacement account");
    await pool.execute("UPDATE tenant_user SET status=1 WHERE id=?", [first.user.userId]);
    await pool.execute("UPDATE tenant SET status=0 WHERE id=?", [first.user.tenantId]);
    await expectError(async () => finish(await start()), "account_disabled", "disabled workspace cannot be bypassed through WorkBuddy");
    await pool.execute("UPDATE tenant SET status=1 WHERE id=?", [first.user.tenantId]);
    const cancelled = await start(); cancelled.params.delete("code"); cancelled.params.set("error", "access_denied");
    await assert.rejects(() => finish(cancelled), (e: any) => e.code === "access_denied" && e.returnTo === next); check(true, "cancelled login retains original consent for retry");
    await expectError(() => finish(cancelled), "invalid_state", "cancelled state is consumed");
    const expired = await start(); await pool.execute("UPDATE studio_workbuddy_login_request SET expires_at=0");
    await expectError(() => finish(expired), "invalid_state", "expired state rejected");
    openId = "op_profile_failure"; profileFails = true;
    const failing = await start();
    await expectError(() => finish(failing), "provider_unavailable", "profile failure does not create partial user");
    assert.deepEqual(await counts(), afterFirst); check(true, "failed upstream response leaves account and space counts unchanged");
    await expectError(() => finish(failing), "invalid_state", "provider failure still consumes callback");
    profileFails = false;
    openId = "op_same_name";
    const different = await finish(await start("https://evil.example/"));
    check(different.user.userId !== first.user.userId && different.returnTo === "/reports", "same nickname never merges identities and external redirect is rejected");
    avatar = "javascript:alert(1)";
    check((await finish(await start())).user.avatar === "https://example.com/avatar.png", "invalid avatar does not overwrite stored profile");
    avatar = "https://example.com/avatar.png";
    const [seed] = await pool.query<any[]>("SELECT id,tenant_id FROM tenant_user WHERE username='admin'");
    const admin = { userId: Number(seed[0].id), tenantId: Number(seed[0].tenant_id) };
    const bind = await wb.beginWorkBuddyBinding(admin, origin);
    const bindParams = new URLSearchParams({ state: new URL(bind.url).searchParams.get("state")!, code: "binding-code" });
    await expectError(() => wb.finishWorkBuddyBinding(admin, origin, bindParams, bind.browserNonce, provider), "identity_conflict", "binding cannot steal another user's login identity");
    check(!(await wb.workBuddyStatus(admin)).connected, "rejected binding leaves no credentials behind");
    openId = "op_existing_account";
    const existingBind = await wb.beginWorkBuddyBinding(admin, origin);
    await wb.finishWorkBuddyBinding(admin, origin, new URLSearchParams({ state: new URL(existingBind.url).searchParams.get("state")!, code: "binding-code" }), existingBind.browserNonce, provider);
    check((await finish(await start())).user.userId === admin.userId, "binding an existing account enables login to that account");
    await pool.execute("DELETE FROM user_identity WHERE user_id=? AND provider='workbuddy'", [admin.userId]);
    check((await finish(await start())).user.userId === admin.userId, "unambiguous legacy binding upgrades without creating account");
    await wb.disconnectWorkBuddy(admin);
    const [remaining] = await pool.query<any[]>("SELECT * FROM user_identity WHERE user_id=? AND provider='workbuddy'", [admin.userId]);
    check(!remaining.length && !(await wb.workBuddyStatus(admin)).connected, "account with password can remove WorkBuddy login and credentials together");
    // Legacy duplicates must fail closed instead of selecting an arbitrary account.
    openId = "op_ambiguous";
    for (const who of [first.user, different.user]) await pool.execute("UPDATE studio_workbuddy_binding SET open_id=? WHERE user_id=?", [openId, who.userId]);
    await expectError(async () => finish(await start()), "identity_conflict", "ambiguous historical bindings never choose an account");
    openId = "op_atomic";
    const beforeFailure = await counts();
    await pool.query("CREATE TRIGGER fail_workbuddy_identity BEFORE INSERT ON user_identity WHEN NEW.provider='workbuddy' BEGIN SELECT RAISE(ABORT,'test insert failure'); END");
    await expectError(async () => finish(await start()), "login_failed", "identity persistence failure fails login");
    assert.deepEqual(await counts(), beforeFailure); check(true, "account and workspace roll back atomically on identity failure");
    await pool.query("DROP TRIGGER fail_workbuddy_identity");
    const simultaneous = await Promise.all([start(), start()]);
    const created = await Promise.all(simultaneous.map(s => finish(s)));
    check(created[0].user.userId === created[1].user.userId, "concurrent first login resolves to one user");
    assert.deepEqual(await counts(), beforeFailure.map(n => n + 1)); check(true, "concurrent first login creates only one workspace");
    process.env.WORKBUDDY_CLIENT_ID = "cb_another_app";
    const otherApp = await finish(await start());
    check(otherApp.user.userId !== created[0].user.userId, "open_id is scoped to application ID");
    delete process.env.WORKBUDDY_CLIENT_ID;
    await fs.writeFile(configPath, config.replace("allowRegistration: true", "allowRegistration: false"));
    check(!wb.isWorkBuddyLoginConfigured(), "existing global third-party login policy is respected");
    await expectError(() => start(), "not_configured", "global registration policy rejects direct WorkBuddy login flow");
    await fs.writeFile(configPath, config);
    check(wb.isWorkBuddyLoginConfigured(), "reopening global registration restores configured WorkBuddy login");
    console.log(`\n${checks} WorkBuddy login/identity checks passed (isolated SQLite, mock provider).`);
  } finally { await pool.end(); await fs.rm(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; });
