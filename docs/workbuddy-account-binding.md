# Studio 的 WorkBuddy 登录与账号绑定

## 数据库结构同步

`scripts/sync-workbuddy-schema.ts` 默认只读检查 MySQL，使用 `--output <文件>` 保存结构快照和目标指纹。确认目标后，增加 `--apply --expect-target <只读检查返回的指纹>`，并使用新的输出文件，即可复用服务端的增量建表逻辑。通过 `STUDIO_CONFIG_PATH` 显式选择配置文件，避免误用本地隔离 SQLite。

同步包含 API 管理、MCP OAuth、报表预览和 WorkBuddy 登录/绑定的 12 张表。已有 `tenant_user.avatar`、`user_identity` 及身份唯一索引必须通过前置检查；脚本不调用账号初始化或写入业务记录。执行后使用独立数据库连接核查结构及关键索引。MySQL DDL 会自动提交，执行记录会在变更前保存，发生中途错误时应依据记录检查已完成的结构变更。

此功能是 **Studio → WorkBuddy Open API** 的授权，不替代 **WorkBuddy → Studio MCP** 的连接器授权。

官方依据（2026-10-10 核对）：
- https://open.workbuddy.cn/docs/openapi#认证授权-api
- https://open.workbuddy.cn/docs/buddy-app

## 数问应用与 Studio 连接流程（当前方案）

数问默认使用云端 Studio 连接器。用户进入 Studio 的 `/oauth/authorize` 授权页，未登录时通过 `next` 返回参数进入现有登录页。页面增加「使用 WorkBuddy 登录」，首次使用自动创建 Studio 账号和个人空间；再次登录复用原账号。手机号、邮箱、GitHub、Google 等原有方式继续保留。

第三方登录按钮按 WorkBuddy、GitHub、Google 排列，使用统一样式；WorkBuddy 按钮仅保留官方图标和名称。普通登录页也可使用此入口。登录成功后恢复原 Studio 授权请求，由用户明确确认工作空间访问权限。身份登录本身不会授予 MCP 权限。

登录按钮使用 WorkBuddy 官网的官方 SVG 图标，本地资源为 `public/brands/workbuddy.svg`。来源：`https://assets.workbuddy.cn/web/workbuddy/f4728a12fe9cfe5a34da6b2fa827614041c84386/assets/logo.svg`（2026-10-10 从官网 favicon 引用核对）。

已有 Studio 账号的用户应先用原方式登录，再在 API 管理绑定 WorkBuddy，避免另建账号。已登录用户不会被自动切换或另建账号。需要私有部署时，在 WorkBuddy 中手动启用私有连接器。

此版本复用现有 `tenant_user`、`tenant` 和 `user_identity`，不建立“数问用户表”。原有 Studio → WorkBuddy 授权基础同时支持登录和已登录账号绑定，复用同一个平台回调地址。WorkBuddy → Studio MCP 的授权请求、授权记录及 Token 仍独立。

只有完成 WorkBuddy 身份登录或绑定，才有平台 `open_id` 与 Studio 账号的关联记录。使用其他方式登录的用户、未完成授权的访客不能推断为已关联的 WorkBuddy 用户。

### 身份与并发规则

- `user_identity.provider = 'workbuddy'`，`provider_key = SHA256(JSON.stringify([clientId, openId]))`。复用现有 `(provider, provider_key)` 和 `(user_id, provider)` 唯一约束；每个 Studio 账号当前关联一个 WorkBuddy 身份。
- 昵称、头像不用于合并账号，不假设平台提供邮箱或手机号。新账号无默认密码，角色为 `developer`。
- 创建个人空间、账号、登录身份、授权凭证在同一事务内完成；本地唯一键或死锁竞争可以重试，平台授权码不重放。
- 历史绑定在用户通过 WorkBuddy 身份校验后按需升级。如果同一应用与 open_id 指向多个 Studio 账号，返回冲突，禁止任选一个登录。没有执行生产批量合并或迁移。
- 登录 state 存入新增 `studio_workbuddy_login_request`，仅保存 state/browser 摘要、应用、回调、返回目标和有效期，无需已有用户。十分钟有效，一次性消费，与已有登录后绑定请求表分开。
- 注册开关 `auth.allowRegistration: false` 沿用现有“关闭非账号密码登录”的策略，WorkBuddy 登录也关闭。所有第三方登录统一受此开关控制。
- 解除绑定同时移除对应 WorkBuddy 登录身份和本地授权凭据。如果这是唯一可用登录方式则拒绝解除，防止账号失去入口。MCP 授权不因解绑 WorkBuddy 身份而被隐式撤销。

## Buddy 应用默认连接配置

官方文档明确：首次完成 Buddy 应用授权后，用户点击绑定内置连接器，进入 MCP OAuth 流程。无需新增另一套应用登录或自动建号接口。

- 内置连接器：数问·DataTalk Studio（source `shuwen-studio-cloud`，平台资产 `oc_5e0e40c969aa2882`）。
- 跳过首次绑定内置连接器：关闭。
- 首次绑定介绍文案：`DataTalk Studio 数据分析与报表开发`。
- 私有部署连接器放在应用市场供用户手动启用，不设为默认内置连接器。

2026-10-10 实际检查：内置连接器选择框搜索“数问”显示“暂无可选连接器”，需要云端连接器上架后才能完成选择；首页胶囊和工作模式也尚未配齐，当前不能宣称应用配置已保存或上线。

## 开放平台配置

数问应用：`cb_MUK7rd4bmPIkNH6zlcPD`

生产 OAuth 回调地址：
```text
https://studio.alenfive.top/api/integrations/workbuddy/callback
```

本地测试需在平台回调白名单中另行登记：
```text
http://127.0.0.1:3010/api/integrations/workbuddy/callback
```

本地 HTTP 是否允许、应用待配置状态是否允许发起授权，以平台实际校验为准；不允许时需用已登记的 HTTPS 测试部署。本地回调不能替代生产回调。

此地址接收平台的 `code` 和 `state`，不是 MCP Server 地址，也不是 Studio 的 `/oauth/authorize`。填入表单不代表服务已部署或平台配置已生效。当前应用首页配置未完成，预览与提交审核按钮不可用；必须完成应用配置并验证回调已登记后才能真实验收。

## 服务端配置

推荐在服务端 `config/config.local.yaml` 中配置 Studio 对外地址和应用凭据：

```yaml
site:
  studioPublicUrl: "https://studio.alenfive.top"
auth:
  allowRegistration: true
  workbuddy:
    clientId: "你的 WorkBuddy 应用 Client ID"
    clientSecret: "你的 WorkBuddy 应用 Client Secret"
```

此文件已被 Git 忽略，包含真实凭据时权限应设为 `0600`。凭据仅由服务端读取，不返回浏览器。部署时需要在服务器配置同样的内容。

| 环境变量 | 含义 |
| --- | --- |
| `STUDIO_PUBLIC_URL` | 当前 Studio 的 HTTPS origin，无路径；也可填写 `site.studioPublicUrl`，环境变量优先 |
| `WORKBUDDY_CLIENT_ID` | 数问应用的 Client ID |
| `WORKBUDDY_CLIENT_SECRET` | 创建应用时展示一次的 Client Secret，仅服务端使用 |
| `WORKBUDDY_CLIENT_SECRET_FILE` | 可选，用受保护文件提供 Secret；环境变量中的 Secret 优先 |
| `WORKBUDDY_TOKEN_ENCRYPTION_KEY` | 可选，64 位十六进制 AES-256 密钥；多副本应使用同一密钥 |
| `STUDIO_WORKBUDDY_CONFIG_PATH` | 可选，仅为 WorkBuddy 凭据指定 YAML 文件，不改变数据库等配置；本地隔离启动脚本使用 |

Client ID 优先读取环境变量，再读取 YAML；Client Secret 优先读取环境变量、显式指定的 Secret 文件，最后读取 YAML。通常只需填写 YAML，无需设置这些凭据环境变量。

未提供加密密钥时自动创建持久工作区 `runtime/workbuddy-token.key`（0600）。须与数据库一起备份，多副本共享此文件或配置同一环境变量。丢失密钥后已保存凭证无法读取，需要重新绑定。该机制与明文保存的 Studio API Key 独立。

`scripts/run-workbuddy-local.sh` 从 `config/config.local.yaml` 读取 `workbuddy` 段，同时保留 `.workbuddy-local/studio.yaml` 中的隔离 SQLite 配置。无需另外维护 Secret 文件，也不会因读取凭据而连接常规配置中的数据库。不要提交真实 Secret，也不要用假 Secret 发起真实平台授权。

## 用户流程

1. 登录页点击 **使用 WorkBuddy 登录**，或已有 Studio 账号登录后，在 **API 管理 → 绑定 WorkBuddy 账号** 点击绑定。
2. Studio 生成一次性 state 和 HttpOnly 浏览器校验 cookie。授权请求明确只申请 `user.profile.readable`。
3. 跳转 WorkBuddy，由用户本人确认授权。
4. 共用回调通过 state 类型区分登录与绑定，并验证浏览器 nonce、有效期和精确回调地址。绑定还要求匹配发起时的 Studio 用户与工作空间；登录使用一次性请求查找或创建账号，由服务端签发 Studio 登录会话。
5. 保存绑定后读取昵称、头像。有效 HTTPS 头像写入 `tenant_user.avatar`，Studio 姓名保持原值。侧边栏展示头像，加载失败回退姓名首字。
6. 刷新资料时自动更新临近过期的 token，并发请求串行刷新。授权失效提示重新绑定。
7. 确认存在其他可用登录方式后，解除绑定删除 Studio 保存的 WorkBuddy 登录身份、凭证和未完成绑定请求。官方文档未列出 token revoke 接口，平台侧授权需用户在 WorkBuddy 内取消。

当前没有创建/发送 WorkBuddy 任务入口。以后增加任务能力须明确申请 `user.task.readable`、`user.task.invokable` 等 scope，并增加对应交互与测试。已有 Studio MCP 授权不会由本功能重复获取或撤销。

## 接口

- `GET /api/auth/workbuddy?next=...`：匿名用户发起登录，已登录用户直接继续原目标。

- `GET /api/integrations/workbuddy`：当前账号绑定状态和回调地址，不返回 token 或 open_id。
- `POST /api/integrations/workbuddy`：同源登录用户发起授权，返回 WorkBuddy 授权 URL。
- `GET /api/integrations/workbuddy/callback`：登录成功签发会话并返回安全的原目标；绑定结果 303 跳转回管理页。取消登录保留原目标便于重试；错误不回显上游凭据。
- `POST /api/integrations/workbuddy/profile`：刷新资料，服务端处理 token 刷新。
- `DELETE /api/integrations/workbuddy`：同源登录用户解除自己的绑定。

Token 请求禁止重定向，设置超时和响应大小限制。回调不把 code/token 或上游错误详情转发到结果页，响应禁用缓存并设置 `Referrer-Policy: no-referrer`。生产反向代理访问日志应隐藏回调查询串，避免记录短期授权码。

## 数据结构

```sql
-- MySQL；自动初始化及 init-members 均支持旧表增量补列。
ALTER TABLE tenant_user ADD COLUMN avatar varchar(2048) NULL AFTER name;
```

SQLite 对应 `avatar TEXT NULL`，存储头像地址，非二进制。旧用户默认 NULL，现有数据保留。AuthSession 和成员查询从数据库读取规范化后的头像，兼容旧登录 cookie。解除 WorkBuddy 绑定不会清空已同步的 Studio 头像。

原有 `studio_workbuddy_request` 保存一次性 state/browser 摘要、用户、租户、应用、回调地址和有效期；原有 `studio_workbuddy_binding` 保存按 tenant/user/client 隔离的 open_id、昵称、scope、AES-GCM 加密的 token、有效期、需重新授权标志和更新时间。这两张表与 Studio 对外签发 OAuth token 的表完全分开。

本次额外新增 `studio_workbuddy_login_request`（未登录时的短期登录请求），并为 `studio_workbuddy_binding(client_id, open_id)` 增加非唯一查询索引。账号归属的唯一约束仍由现有 `user_identity` 负责。首次调用时自动增量建表和建索引，不修改现有用户字段，也不批量合并历史账号。

## 验证

```bash
npm run test:workbuddy-binding
npm run test:workbuddy-login
npm run test:studio-login-return
npm run typecheck
```

测试自行创建并清理隔离 SQLite，使用模拟 WorkBuddy 响应验证协议与失效场景；不会使用真实 Secret，不代表真实平台授权成功。真实闭环需密钥、回调白名单、应用状态与可访问的服务端全部就绪。

`test:studio-login-return` 启动隔离的 Studio 服务，验证匿名跳转、登录／注册／找回密码的授权提示、第三方登录发起时返回地址保存、模拟邮件投递下的真实注册接口、账号密码登录、显式授权与 PKCE 换取 Token，以及生产 YAML origin 配置。不会发送真实邮件或完成第三方账号授权。

`test:workbuddy-login` 验证新用户、重复／并发登录、身份唯一性、老账号绑定升级、历史歧义、禁用账号、事务回滚和唯一登录方式保护。`test:studio-login-return` 在隔离 Next 子进程中使用测试专用 provider mock，实际请求 WorkBuddy 登录入口与共用回调，验证 Cookie、登录返回、取消、重放防护，再完成 MCP 显式授权与 PKCE 交换。测试 mock 不进入应用代码，不连接真实 WorkBuddy 用户。
