import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

async function main() {
  const root = await fs.mkdtemp(path.resolve(".workbuddy-local/login-return-"));
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const configPath = path.join(root, "studio.yaml");
  const config = `database:\n  url: "sqlite:${root}/test.sqlite"\nsite:\n  studioPublicUrl: ""\nauth:\n  allowRegistration: true\n  github:\n    clientId: test-only\n    clientSecret: test-only\n  google:\n    clientId: test-only\n    clientSecret: test-only\nemail:\n  smtp:\n    host: localhost\n    port: 465\n    user: test-only\n    password: test-only\n    from: test@example.invalid\n`;
  await fs.writeFile(configPath, config);
  // This preload belongs only to the isolated test server, never to application code.
  const providerMock = path.join(root, "workbuddy-provider.mjs");
  await fs.writeFile(providerMock, `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://www.workbuddy.cn/openapi/v2/token') {
        return Response.json({access_token:'local-wb-access',refresh_token:'local-wb-refresh',open_id:'op_http_fixture',token_type:'Bearer',expires_in:3600,scope:'user.profile.readable'});
      }
      if (url === 'https://www.workbuddy.cn/openapi/v2/user/profile') return Response.json({nickname:'WorkBuddy HTTP 用户',avatar:'https://example.com/avatar.png'});
      return originalFetch(input, init);
    };
  `);
  Object.assign(process.env, {
    STUDIO_CONFIG_PATH: configPath, WORKSPACE_STORAGE_ROOT: path.join(root, "workspace"),
    AUTH_SESSION_SECRET: randomBytes(32).toString("hex"), STUDIO_PUBLIC_URL: "",
    AUTH_COOKIE_DOMAIN: "", AUTO_START_AGENT_RUNTIME: "false", NODE_ENV: "development",
    GITHUB_REDIRECT_URI: `${base}/api/auth/github/callback`, GOOGLE_REDIRECT_URI: `${base}/api/auth/google/callback`,
    WORKBUDDY_CLIENT_ID: "cb_http_test", WORKBUDDY_CLIENT_SECRET: "http-test-only-secret", STUDIO_WORKBUDDY_CONFIG_PATH: configPath,
  });
  const dist = ".next-workbuddy-login-check";
  const tsconfig = JSON.parse(await fs.readFile("tsconfig.json", "utf8"));
  tsconfig.extends = "../../tsconfig.json";
  tsconfig.compilerOptions = { ...tsconfig.compilerOptions, baseUrl: "../..", incremental: false };
  tsconfig.include = ["../../next-env.d.ts", "../../**/*.ts", "../../**/*.tsx", `../../${dist}/dev/types/**/*.ts`];
  tsconfig.exclude = ["../../node_modules", "../../.next*/**"];
  const tsconfigPath = path.join(root, "tsconfig.json");
  await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig));
  const originalNextEnv = await fs.readFile("next-env.d.ts", "utf8");
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${providerMock}`, STUDIO_DIST_DIR: dist, STUDIO_TSCONFIG_PATH: path.relative(process.cwd(), tsconfigPath) }, stdio: "ignore",
  });
  const { getDbPool } = await import("../lib/server/mysql");
  const pool = getDbPool();
  let checks = 0;
  function check(value: unknown, label: string) { assert.ok(value, label); checks++; console.log(`PASS ${label}`); }
  async function request(route: string, init: RequestInit = {}) {
    const response = await fetch(new URL(route, base), { redirect: "manual", signal: AbortSignal.timeout(60000), ...init });
    const text = await response.text();
    let data: any; try { data = JSON.parse(text); } catch { data = null; }
    return { response, text, data };
  }
  const post = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  try {
    let ready = false;
    for (let n = 0; n < 90; n++) {
      if (child.exitCode !== null) throw new Error("Isolated Next server exited");
      try { ready = (await request("/.well-known/oauth-authorization-server")).response.status === 200; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    check(ready, "isolated Studio server started without production database access");
    const callback = "http://127.0.0.1:47123/oauth/callback";
    const client = (await request("/oauth/register", post({ client_name: "WorkBuddy", redirect_uris: [callback], token_endpoint_auth_method: "none" }))).data.client_id;
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({ response_type: "code", client_id: client, redirect_uri: callback, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", scope: "studio", state: "test-return-state", resource: `${base}/api/mcp` });
    const consent = `/oauth/authorize?${params}`;
    const login = `/?next=${encodeURIComponent(consent)}`;
    const entry = await request(consent);
    check(entry.response.status === 307 && new URL(entry.response.headers.get("location")!, base).searchParams.get("next") === consent, "anonymous consent preserves original OAuth request through login");
    for (const [page, action] of [[login, "登录"], [`/register?next=${encodeURIComponent(consent)}`, "注册"], [`/reset-password?next=${encodeURIComponent(consent)}`, "重设密码"]]) {
      const result = await request(page);
      check(result.response.status === 200 && result.text.includes('aria-label="连接授权提示"') && result.text.includes("WorkBuddy") && result.text.includes(action) && result.text.includes(client), `${action} page retains authorization context and return parameters`);
    }
    const plain = await request("/");
    check(!plain.text.includes('aria-label="连接授权提示"'), "normal Studio login has no connector-specific prompt");
    const forged = new URLSearchParams(params); forged.set("client_id", "unregistered");
    check(!(await request(`/?next=${encodeURIComponent(`/oauth/authorize?${forged}`)}`)).text.includes('aria-label="连接授权提示"'), "unregistered client cannot inject an authorization notice");
    for (const provider of ["github", "google"]) {
      const result = await request(`/api/auth/${provider}?next=${encodeURIComponent(consent)}`);
      const cookies = result.response.headers.getSetCookie();
      check(result.response.status === 307 && cookies.some(c => c.startsWith(`datatalk-${provider}-next=`) && decodeURIComponent(c.split(";")[0].split("=").slice(1).join("=")) === consent), `${provider} handoff preserves original consent without contacting the provider`);
    }
    // Exercise the real registration route with a mocked email delivery, never send mail.
    const email = await import("../lib/server/email-auth");
    let verificationCode = "";
    globalThis.__datatalkEmailTransporter = { sendMail: async (message: { text: string }) => { verificationCode = message.text.match(/\b\d{6}\b/)![0]; return {}; } } as any;
    await email.sendEmailCode("login-return@example.invalid");
    const { POST: register } = await import("../app/api/register/route");
    const registration = await register(new Request(`${base}/api/register`, post({ method: "email", username: "login_return_user", password: "local-test-only-pass", confirmPassword: "local-test-only-pass", contact: "login-return@example.invalid", code: verificationCode, returnTo: consent })));
    const registered = await registration.json();
    check(registration.ok && registered.redirectTo === consent, "existing email registration route returns to the exact authorization request");
    const cookie = registration.headers.getSetCookie().find(c => c.startsWith("datatalk-session="))!.split(";")[0];
    const [users] = await pool.query<any[]>("SELECT id,tenant_id FROM tenant_user WHERE username=?", ["login_return_user"]);
    const [spaces] = await pool.query<any[]>("SELECT id FROM tenant WHERE id=?", [users[0].tenant_id]);
    check(users.length === 1 && spaces.length === 1, "normal registration creates one account and its personal workspace");
    const repeated = await request(login, { headers: { Cookie: cookie } });
    check(repeated.response.status === 307 && new URL(repeated.response.headers.get("location")!, base).pathname === "/oauth/authorize", "registered session resumes consent instead of returning to report list");
    const page = await request(consent, { headers: { Cookie: cookie } });
    const requestId = /name="request_id" value="([^"]+)"/.exec(page.text)?.[1];
    check(requestId && page.text.includes("login_return_user") && page.text.includes("授权连接"), "consent displays newly registered account and workspace");
    const [before] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM studio_oauth_grant WHERE client_id=?", [client]);
    check(Number(before[0].n) === 0, "registration and login alone do not grant connector access");
    const granted = await request("/api/oauth/authorize", post({ request_id: requestId, decision: "approve" }, { Origin: base, Cookie: cookie }));
    const location = new URL(granted.response.headers.get("location")!);
    check(granted.response.status === 303 && location.searchParams.get("state") === "test-return-state", "explicit consent returns code and original client state");
    const exchanged = await request("/oauth/token", post({ grant_type: "authorization_code", client_id: client, code: location.searchParams.get("code"), redirect_uri: callback, code_verifier: verifier, resource: `${base}/api/mcp` }));
    check(exchanged.response.ok && exchanged.data.access_token, "normal registration followed by consent completes PKCE token exchange");
    const existing = await request("/api/login", post({ username: "login_return_user", password: "local-test-only-pass", returnTo: consent }));
    check(existing.response.ok && existing.data.redirectTo === consent, "existing account password login also restores the authorization request");
    const [after] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM tenant_user WHERE username=?", ["login_return_user"]);
    check(Number(after[0].n) === 1, "repeat login does not create another account");
    const wbLoginPage = await request(login);
    check(wbLoginPage.text.includes("/api/auth/workbuddy") && wbLoginPage.text.includes("/brands/workbuddy.svg"), "login page offers WorkBuddy alongside existing third-party login methods");
    async function wbStart() {
      const start = await request(`/api/auth/workbuddy?next=${encodeURIComponent(consent)}`);
      assert.equal(start.response.status, 303);
      const authorize = new URL(start.response.headers.get("location")!);
      const cookie = start.response.headers.getSetCookie().find(c => c.startsWith("studio-workbuddy-login="))!;
      assert.ok(cookie.includes("HttpOnly") && cookie.includes("SameSite=lax"));
      return { state: authorize.searchParams.get("state")!, cookie: cookie.split(";")[0] };
    }
    const wbStarted = await wbStart();
    check(!!wbStarted.state && !!wbStarted.cookie, "HTTP login entry issues browser-bound state cookie");
    const wbCallback = `/api/integrations/workbuddy/callback?${new URLSearchParams({state:wbStarted.state,code:"test-http-code"})}`;
    const wbWrongBrowser = await request(wbCallback);
    check(new URL(wbWrongBrowser.response.headers.get("location")!).searchParams.get("workbuddy_login") === "invalid_state" && !wbWrongBrowser.response.headers.getSetCookie().some(c => c.startsWith("datatalk-session=")), "callback without initiating browser cookie cannot sign in");
    const wbDone = await request(wbCallback, { headers: { Cookie: wbStarted.cookie } });
    const wbSessionCookie = wbDone.response.headers.getSetCookie().find(c => c.startsWith("datatalk-session="));
    check(wbDone.response.status === 303 && new URL(wbDone.response.headers.get("location")!).pathname === "/oauth/authorize" && wbSessionCookie?.includes("HttpOnly") && wbDone.response.headers.get("referrer-policy") === "no-referrer", "real callback route writes Studio session and returns to consent");
    const wbCookie = wbSessionCookie!.split(";")[0];
    const wbConsent = await request(consent, { headers: { Cookie: wbCookie } });
    check(wbConsent.response.status === 200 && wbConsent.text.includes("WorkBuddy HTTP 用户") && wbConsent.text.includes("授权连接"), "new WorkBuddy account opens original consent with personal workspace");
    const [wbUsers] = await pool.query<any[]>("SELECT u.id,u.tenant_id FROM tenant_user u JOIN user_identity i ON i.user_id=u.id WHERE i.provider='workbuddy'");
    const [wbGrants] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM studio_oauth_grant WHERE user_id=?", [wbUsers[0].id]);
    check(wbUsers.length === 1 && Number(wbGrants[0].n) === 0, "WorkBuddy login itself does not grant MCP access");
    const wbRequest = /name="request_id" value="([^"]+)"/.exec(wbConsent.text)?.[1];
    const wbApproval = await request("/api/oauth/authorize", post({ request_id: wbRequest, decision: "approve" }, { Origin: base, Cookie: wbCookie }));
    const wbCode = new URL(wbApproval.response.headers.get("location")!).searchParams.get("code");
    const wbTokens = await request("/oauth/token", post({ grant_type: "authorization_code", client_id: client, code: wbCode, redirect_uri: callback, code_verifier: verifier, resource: `${base}/api/mcp` }));
    check(wbTokens.response.ok && wbTokens.data.access_token, "WorkBuddy login plus explicit consent completes MCP PKCE exchange");
    const replay = await request(wbCallback, { headers: { Cookie: wbStarted.cookie } });
    check(new URL(replay.response.headers.get("location")!).searchParams.get("workbuddy_login") === "invalid_state" && !replay.response.headers.getSetCookie().some(c => c.startsWith("datatalk-session=")), "HTTP callback replay cannot issue another login session");
    const cancel = await wbStart();
    const cancelled = await request(`/api/integrations/workbuddy/callback?${new URLSearchParams({state:cancel.state,error:"access_denied"})}`, {headers:{Cookie:cancel.cookie}});
    const cancelledUrl = new URL(cancelled.response.headers.get("location")!);
    check(cancelledUrl.searchParams.get("next") === consent && cancelledUrl.searchParams.get("workbuddy_login") === "access_denied", "cancelled HTTP login preserves original next and sanitized message");
    const cancelledPage = await request(cancelledUrl.toString());
    check(cancelledPage.text.includes("已取消 WorkBuddy 登录"), "cancelled login shows recoverable message on login page");
    const changed = await wbStart();
    const switched = await request(`/api/integrations/workbuddy/callback?${new URLSearchParams({state:changed.state,code:"unused"})}`, {headers:{Cookie:`${changed.cookie}; ${cookie}`}});
    check(new URL(switched.response.headers.get("location")!).searchParams.get("workbuddy_login") === "account_changed" && !switched.response.headers.getSetCookie().some(c => c.startsWith("datatalk-session=")), "callback does not replace an account signed in in another tab");
    const signedInStart = await request(`/api/auth/workbuddy?next=${encodeURIComponent(consent)}`, {headers:{Cookie:wbCookie}});
    check(new URL(signedInStart.response.headers.get("location")!).pathname === "/oauth/authorize", "already signed-in user proceeds without another WorkBuddy authorization");
    const { studioOrigin } = await import("../lib/server/studio-oauth");
    await fs.writeFile(configPath, config.replace('studioPublicUrl: ""', 'studioPublicUrl: "https://studio.example.com"'));
    Object.assign(process.env, { NODE_ENV: "production" });
    check(studioOrigin("http://internal:3000") === "https://studio.example.com", "production canonical origin can be read from YAML behind a proxy");
    process.env.STUDIO_PUBLIC_URL = "https://override.example.com";
    check(studioOrigin() === "https://override.example.com", "environment override takes precedence over YAML");
    process.env.STUDIO_PUBLIC_URL = "https://studio.example.com/path";
    assert.throws(() => studioOrigin(), /不包含路径/); check(true, "production canonical origin rejects paths");
    delete process.env.STUDIO_PUBLIC_URL;
    await fs.writeFile(configPath, config);
    assert.throws(() => studioOrigin("https://spoofed.example.com"), /请配置 HTTPS/); check(true, "production never trusts the request host without canonical configuration");
    console.log(`\n${checks} Studio login/registration/consent checks passed; mocked email delivery and isolated SQLite.`);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise<void>(resolve => { const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000); child.once("exit", () => { clearTimeout(timer); resolve(); }); });
    await pool.end();
    const current = await fs.readFile("next-env.d.ts", "utf8");
    if (current.includes(dist)) await fs.writeFile("next-env.d.ts", originalNextEnv);
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; });
