# Studio API 管理与 WorkBuddy MCP

Studio 绑定 WorkBuddy 账号、Buddy 应用回调配置与头像同步见 [WorkBuddy 账号绑定](./workbuddy-account-binding.md)。该授权方向与本页的 MCP 接入不同。

用于当前租户内的数据分析与报表开发。MCP 支持报表源码的创建、读取、编辑、重命名、复制、Studio 发布及资源中心上架；可读取或配置公共链接，但不会返回链接密码。资源中心工具仅在 `resourceCenter.enabled`（或 `RESOURCE_CENTER_ENABLED`）开启时出现在 MCP 工具清单中。删除、回滚和数据库凭据管理不暴露给 MCP。

## 用户操作

登录 Studio → 左侧独立菜单“API 管理”（`/api-management`），创建 Key 时只填写名称，不设置权限或有效期。新 Key 一直有效，直到用户主动删除。名称与 API Key 分列展示，API Key 默认脱敏；点击右侧图标后由本人登录会话直接从数据库读取完整值并复制到剪贴板。数据库使用 `api_key` 字段明文存储完整 Key，不进行摘要存储或加密解密。列表和调用日志不返回完整 Key。

Key 绑定当前账号与租户，可分析已连接的数据、创建和编辑报表。每次请求按完整 Key 匹配，检查用户状态、租户状态和当前角色，服务端内部继续执行租户隔离检查。所有有效 Key 使用相同的工具能力，不配置单独的权限或有效期。当前没有细化到单个目录或数据源的 Key 权限。列表显示名称、脱敏 API Key、创建时间和最近使用时间，并提供复制和删除操作。

删除会物理移除 API Key 记录，使后续请求立即失效；已经开始执行的请求不会被中途取消。历史调用日志保留，已删除的 Key 显示为“已删除的 Key”。调用日志仅保存工具名称、目标报表、Key、状态和时间。API 管理页面暂不展示或加载调用记录，需要时直接查询 `studio_api_log` 表；日志查询接口保留。数据库未自动清理历史日志；上线应按所需保留期配置归档/清理。

## 服务部署

- 正常启动时使用现有 Studio 配置。`STUDIO_CONFIG_PATH` 可显式指定独立 YAML 文件，指定文件不存在时启动失败，避免误回退到共享数据库。
- 并行本地验证可通过 `STUDIO_DIST_DIR` 隔离 Next.js 输出，通过 `STUDIO_TSCONFIG_PATH` 指定独立类型检查配置，避免混入其他运行中开发服务的生成文件。本地联调目录不进入发布文件追踪。
- API Key 表仅保留 `id`、`tenant_id`、`user_id`、`name`、`prefix`、`api_key`、`created_at`、`last_used_at`。新 Key 为 26 字符（`dtk_` 前缀 4 字符加 22 字符随机部分，128 位随机值）；旧的 47 字符 Key 继续有效。`api_key` 字段上限为 47 字符、唯一且区分大小写；不包含权限、有效期、撤销时间、摘要或密文字段。已有旧版表需先迁移完整 Key 到此结构；仅保存摘要的 Key 无法还原。本地联调表已完成迁移并保留原 Key 与 ID。
- Key/调用记录/去重登记/编辑锁表通过 `ensureOpenApiSchema` 首次访问时建立，支持 MySQL 和 SQLite。运行数据库账号需要相应 CREATE TABLE 权限；无 DDL 权限的生产环境应先执行 `scripts/init-studio-open-api.ts`，随后以运行账号启动。
- `reportEditLock.enabled` / `REPORT_EDIT_LOCK_ENABLED` 只控制网页与 MCP 是否启用共享报表编辑互斥锁；设为 `false` 表示不使用互斥锁，不会禁止 MCP 写入。锁启用时网页编辑与 MCP 共用数据库锁，60 秒到期；MCP 每 15 秒续约。锁关闭时，MCP 编辑仍受 `reports:write` 权限、租户/报表校验、当前版本冲突、工作区未提交更改检查和报表结构校验约束，但不会与网页编辑互斥。多实例启用锁时必须共用同一数据库及同一个报表工作区。
- 公网部署通过 HTTPS 提供 `/api/mcp`；反向代理需保留 Host 并正确设置 X-Forwarded-Proto。内网 HTTP 仅用于本机开发验证。
- 请求最大 2MB、单文件最大 512KB、一次读取总源码最大 1.5MB。数据预览最多 20 行、256KB，沿用查询网关的只读限制和 60 秒超时。查询结果只属于预览样本。
- MCP 使用官方 TypeScript SDK、无状态 Streamable HTTP。每次 POST 创建请求级 transport 和 server，以 JSON 响应结束后关闭；不依赖进程内 MCP session。GET/DELETE 返回 405，无长期 SSE 通知流。
- 报表运行时继承现有 Studio 的执行模型；本次未新增隔离执行沙箱。报表开发 Key 应分配给受信任的报表开发者。

## 接口约定

统一请求头 `Authorization: Bearer <Studio API Key>`。此 Key 与模型供应商 API Key 不同。

- `GET /api/open/v1/me`：连接信息、有效权限、目录、报告开发约定。
- `POST /api/open/v1/tools/<tool>`：JSON 参数，返回业务 JSON。REST 和 MCP 调用同一服务。
- `POST /api/mcp`：MCP initialize、tools/list、tools/call。
- `/api/settings/api-keys` GET/POST 和 `/api/settings/api-keys/<id>` DELETE：使用 Studio 登录会话管理本人 Key；写操作检查同源。
- `POST /api/settings/api-keys/<id>/secret`：本人登录会话按需读取完整 API Key，检查同源与用户/租户归属，响应禁用缓存。
- `GET /api/settings/api-logs`：本人调用记录。

| 工具 | 权限 | 参数概要 |
| --- | --- | --- |
| get_studio_context | 有效 Key | 无 |
| list_data_sources | datasources:read | 无 |
| inspect_data_source_schema | datasources:read | dataSourceRef，keyword/tables/limit 可选 |
| preview_query | data:query | dataSourceRef、sql，params/maxRows 可选 |
| list_reports | reports:read | 无 |
| read_report | reports:read | reportCode，files 可选 |
| create_report | reports:write | name、folderId、operationId |
| rename_report | reports:write | reportCode、name、operationId |
| copy_report | reports:write | reportCode、name 可选、operationId |
| list_public_resources | reports:read | assetType（report/template）、query、category、page、pageSize、sort 可选 |
| copy_public_resource | reports:write | resourceId、operationId、confirm=true；name 可选 |
| apply_report_changes | reports:write | reportCode、baseCommitHash、operationId、message、files，deleteFiles 可选 |
| publish_report | reports:write | reportCode、operationId、confirm=true |
| list_resource_categories | reports:read | assetType 可选（report/template/dataset，默认 report）；仅资源中心启用时提供 |
| publish_to_resource_center | reports:write | reportCode、operationId、confirm=true、categoryId；assetType（report/template）默认 report；title/summary/resourceThumbnailDataUrl 可选 |
| get_report_public_link | reports:write | reportCode |
| configure_report_public_link | reports:write | reportCode、operationId、enabled、confirm=true；passwordEnabled、password（4–20 个字符）、expiresAt、rotate 可选 |
| inspect_report | reports:read | reportCode |

参数严格验证，未知字段包括客户端 tenantId/userId 被拒绝。公共链接密码长度为 4–20 个字符。完整 JSON schema 由 MCP tools/list 返回。

创建使用 Studio 空白模板并初始化 Git。复制会创建独立草稿并排除 runtime 文件；重命名不改变源码。批量编辑需当前 HEAD，拒绝未提交编辑；执行源码校验后提交。`publish_report` 需显式 `confirm=true`，且仅从干净、已保存的 working 工作区创建一个 Studio 发布版本；它不会自动启用公共链接，也不会发布到资源中心。

资源中心启用时，`list_public_resources` 使用与 DataTalk 官网相同的 `resource_item`、`tenant_report`、`report_release` 数据，只列出 `status='published'` 且存在对应已发布版本的报告和模板；支持按类型、关键词、分类、最新/热门和分页筛选，返回公开元数据及 `detailUrl`（官网资源详情页）和 `previewUrl`（Studio `/share/<code>` 只读发布版预览；未配置有效 Studio public origin 时为 `null`），不返回源码。客户端可将两个 URL 展示为可点击 Markdown 链接；打开预览会增加资源访问量，但不会修改报表。用户选定条目并确认后，`copy_public_resource` 从该资源的已发布快照复制到当前租户默认报表目录，创建独立草稿，不复制运行时和发布状态、不修改源资源。随后调用 `read_report` 读取自己草稿源码，再通过 `apply_report_changes` 二次开发；资源在复制前下架或版本失效时拒绝复制。上架工具还可按类型调用 `list_resource_categories` 获取有效分类（报告、模板、数据集）；发布工具支持 `report` 与 `template`，数据集目前仅提供分类查询。`publish_to_resource_center` 必须在用户明确确认具体报表、资源类型、标题/摘要、分类、缩略图及公开上架范围后调用，并传 `confirm=true`。未提供标题/摘要时采用报表当前标题与副标题；默认使用 Studio 生成的资源缩略图 `variant=resource`，可选 `resourceThumbnailDataUrl` 可传 PNG/SVG data URL（最多 1,000,000 字符）覆盖。若工作区提交已变化或尚无 Studio 发布版本，工具会先创建新的 Studio 发布版本，再同步资源条目；否则沿用当前发布版本。资源中心上架会把资源条目标记为已发布，可被资源中心用户公开发现；它不等同于公共链接分享，且不会启用公共链接。

`configure_report_public_link` 可创建/停用公共链接、配置密码保护和有效期；启用时要求用户针对具体报表明确确认并传 `confirm=true`，且报表必须已有 Studio 发布版本。默认不设密码；明确启用密码保护但未指定密码时，使用 Studio 默认生成的 4 位随机数字密码；指定密码为 4–20 个字符。服务端不会在工具结果中回显密码；客户端不得在回复或日志中输出密码。`get_report_public_link` 只读返回当前链接状态。公共链接设置变更会使链接可被持有 URL 的任何人访问，须先说明分享范围再执行。工具本身不能代替对具体发布、公共分享或资源中心上架动作的用户确认。server.js 为 `module.exports={handlers:{}}` 处理器模块，不能监听 HTTP 端口。

operationId 在用户/租户范围内去重；相同内容重试返回原结果，内容不同返回 IDEMPOTENCY_CONFLICT。执行结果与可恢复失败保存到操作表；执行时进程终止可能留下 OPERATION_PENDING，需核对报表 Git/audit 后人工恢复，不自动重复写入。校验失败回退至原版；已提交但审计登记失败时返回 saved:true,auditStatus:pending。该状态不等于保存失败。

REST 错误格式为 `{ "error": { "code": "...", "message": "...", "details": ... }`。MCP 业务错误使用 `isError:true` 与同样错误结构。所有有效 Key 返回相同工具；资源中心启用时 18 个，未启用时 14 个。当前账号角色和租户隔离继续在服务端校验。

## 预览边界

inspect_report 校验结构和运行时模块，不进行截图检查。随后签发一次性预览票据（2 分钟有效），浏览器访问 `/api/open/preview#ticket=...`，页面通过同源 POST 兑换仅对指定报表有效的 HttpOnly 会话（30 分钟），跳转到不含票据的 `/preview/<code>`。GET/HEAD 探测不消费票据；票据保存在 URL fragment，不进入服务器访问路径日志。预览会话仅适用于该报表页面、动态数据处理器和已允许的报表附件路径，不授予工作台后台登录权限，也不是公共分享链接。每次访问重查原始 API Key / OAuth 授权和账号状态；物理删除 Key、取消授权、停用账号均阻断后续预览请求。

create_report / apply_report_changes 的幂等结果仍返回普通地址，需要后续调用 inspect_report 获取新票据，避免重试返回已过期的一次性链接。

## 本地联调

运行 `bash scripts/run-workbuddy-local.sh`，在 127.0.0.1:3010 启动独立 SQLite 环境，不修改现有数据库配置或共享数据。首次初始化使用 Studio 既有的本地默认账号 `admin/admin` 和 `dev/dev`，仅供回环地址联调。

随后用 Node 22.5+：

```bash
STUDIO_CONFIG_PATH="$PWD/.workbuddy-local/studio.yaml" \
WORKSPACE_STORAGE_ROOT="$PWD/.workbuddy-local/workspace" \
npm run test:studio-api
```

测试建立标注为测试的 SQLite orders 数据源，验证收入 2000、明文 Key 存储、复制、账号与租户隔离、鉴权、SQL 写保护、目录/文件校验、锁开启与关闭时的编辑、去重、版本冲突、校验回退、MCP SDK 调用和 Key 失效。它创建一个不设有效期的联调 Key，仅写入被 Git 忽略的 `.workbuddy-local/workbuddy.mcp.credentials.json`，权限 0600。该文件包含真实 Key，不上报、不打包、不放进对话。

市场连接器位于工程根目录 `data-agent/connectors/shuwen-datatalk-studio/`，其中的 URL/Key 均为占位符。连接器要求 WorkBuddy ≥4.24.0。官方文档的包内 transport 字段为 `streamableHttp`；本地桌面自定义 MCP 配置使用 `streamable-http`。

### WorkBuddy 本地专家与连接配置

在工程根目录运行 `python3 data-agent/scripts/build_studio_local_expert.py`，使用 WorkBuddy 自带 expert-manager 注册“数问·报表开发专家”。在“专家·技能·连接器 → 我的专家 → 我创建的”召唤该专家，复用全局已配置的工作台连接。

当前专家包不再内嵌 MCP，也不声明云端、私有部署两个必选依赖。云端连接由 MCP 服务端发起 OAuth；私有部署连接器通过 token-schema.json 收集 Base URL 与 API Key。普通桌面自定义 MCP 的 JSON 配置本身没有动态表单，需在连接配置中提供 URL 和 Authorization 请求头。正式连接器安装后的表单、更新与市场升级路径仍需独立验收。

本地私有部署入口为 `http://127.0.0.1:3010/api/mcp`；云端联调也指向该隔离环境，但不设置 Authorization 请求头，由 WorkBuddy 完成 OAuth 获取令牌。客户端配置含凭证，不进入上传包。旧版本“专家内嵌 MCP 原生表单”的验收记录保留为历史证据，不代表当前共享连接方案。

本地验证截图与审计结果放在工程根目录 `data-agent/submissions/studio-mcp-2026-10-10/`。


## DataTalk Studio：云端与私有部署

产品名称：**DataTalk Studio**。AI 原生的数据分析与报表开发工作台。

- 默认连接器“数问·DataTalk Studio” `shuwen-studio-cloud`：MCP 服务端 OAuth 2.1 + PKCE S256；connector-meta.json 省略 auth_mode。
- 私有部署连接器“数问·DataTalk Studio（私有部署）” `shuwen-studio-private`：auth_mode=token；用户填写 Base URL 和 API Key。
- 一个专家复用 WorkBuddy 已配置的连接，不强制同时依赖两种连接器；多个可用连接先选目标，再固定读写同一连接。WorkBuddy 文档未确认支持原生 either/or 依赖，因此通过技能路由实现选择，不声称有原生二选一弹窗。

依据：[WorkBuddy 连接器文档](https://open.workbuddy.cn/docs/connector)，同一服务的 OAuth 和 Token 必须分别使用不同 source。

### OAuth 服务端

部署时设置 `STUDIO_PUBLIC_URL=https://studio.alenfive.top`（私有域名用自己的 HTTPS origin，不带路径）。未配置可信 HTTPS origin 时生产 OAuth 关闭；原 API Key 不受影响。开发模式仅允许本机 loopback HTTP。

| 路径 | 作用 |
| --- | --- |
| `/.well-known/oauth-protected-resource`（另支持 `/api/mcp` 后缀） | 资源发现 |
| `/.well-known/oauth-authorization-server` | OAuth 元数据 |
| `/oauth/register` | 公共客户端动态注册，无 client_secret |
| `/oauth/authorize` | 登录后展示授权范围和当前工作空间 |
| `/api/oauth/authorize` | 同源、当前用户绑定、一次性请求确认 |
| `/oauth/token` | 授权码兑换、刷新令牌轮换 |
| `/oauth/revoke` | RFC7009 撤回连接 |
| `/api/settings/oauth-grants` | 当前账号的已授权应用 |

回调地址按注册字符串精确匹配。支持 WorkBuddy 自定义协议、带动态端口的 loopback 回调及 HTTPS 回调。授权码 2 分钟、access token 1 小时、refresh token 30 天。授权码与刷新令牌重复使用会终止整条授权；刷新与撤销按 grant 行加锁串行处理。OAuth 凭证仅保存 SHA-256 摘要，API Key 表仍按已确认设计保存明文，未重新引入权限、有效期或撤销列。

新增表：studio_oauth_client、studio_oauth_request、studio_oauth_grant、studio_oauth_token、studio_preview_session。studio_api_log 增加 oauth_grant_id；API Key 调用保留真实 key_id，OAuth 调用用 key_id=0 和 oauth_grant_id 标识。自动建表/增列同时覆盖 SQLite 与 MySQL；本轮运行验收使用隔离 SQLite，未写共享 MySQL。

### 本地验证与部署边界

```bash
bash scripts/run-workbuddy-local.sh
STUDIO_CONFIG_PATH="$PWD/.workbuddy-local/studio.yaml" WORKSPACE_STORAGE_ROOT="$PWD/.workbuddy-local/workspace" npm run test:studio-api
STUDIO_CONFIG_PATH="$PWD/.workbuddy-local/studio.yaml" WORKSPACE_STORAGE_ROOT="$PWD/.workbuddy-local/workspace" npm run test:studio-oauth
```

隔离环境为 `.workbuddy-local/studio.sqlite` 和 `.workbuddy-local/workspace`。测试不会对接共享数据库。验收覆盖真实数据处理器（paid 收入 2000：直营 1200、线上 800）、令牌绑定、PKCE、轮换重放、并发刷新、取消授权、预览过期与跨报表访问拒绝。

公有云上架前仍需部署服务端、设置 HTTPS origin，并在云端实际完成回调验收；本次不部署、不提交 WorkBuddy 审核。对公网暴露动态注册与 token 端点时，沿用网关速率限制和请求日志脱敏（尤其授权码与预览票据）；过期请求及凭证按运维保留策略清理，尚未引入自动定时清理任务。

## MCP 独立报表流程（0.3.2）

报表开发无需客户端安装 Skill。`initialize.instructions` 与 `get_studio_context.workflowContract`
共同提供服务端工作流，契约版本为 `2026-11-17.mcp-only.1`，`requiresSkill=false`。
真实数据继续使用指标检索、固定版本绑定、候选验证与提交；仅用户明确指定的模拟数据可跳过真实查询和共享指标流程。

- 整体改名：`rename_report` 仅更新元数据，返回 `sourceChanged=false`；重新 `read_report` 后，最小修改 `report.json.name` 和用户要求的页面标题。两步不是原子操作。
- `apply_report_changes.expectedReportName` 是可选的元数据并发保护。名称不符时返回 `REPORT_NAME_CONFLICT`，在写文件和 Git 提交之前拒绝，读回后形成新的逻辑操作；既有调用仍兼容。
- 保存返回 `acceptance`：结构检查结果与 `requirements/visual=not_checked` 分开，不能冒充业务验收或视觉验收。
- `inspect_report` 返回实际 `report` 元数据、`workflowVersion`、`nameConsistency`、`acceptance`、预览说明。名称诊断只比对元数据和 manifest，不声称检查动态 DOM 标题。
- 客户端先确定打开/截图能力，再获取短时预览链接并完整打开；能力不可用或明确捕获权限失败后停止无效重试，不自动更改系统权限。

自检：`scripts/verify-report-workflow-isolated.ts` 使用临时 SQLite/Git 和真实 MCP HTTP handler，验证 initialize、工具发现、工具调用、名称冲突保护、部分改名诊断、编辑锁、版本冲突、租户隔离与一次性预览票据；不连接生产数据库。

### MCP 0.4.0 文件开发（第一阶段）

新增 begin_report_development、inspect_report_development、commit_report_development、close_report_development。MCP 传清单与操作元数据，原始 UTF-8 文件通过短期受限 GET/PUT 通道传输；云端开发快照不改正式工作区，提交仍复用原有版本、锁、指标事务与校验。无文件传输能力的客户端保留 JSON 路径。详见 [文件开发链路](./report-file-development.md)。此版本号描述源码协议，不代表已部署或 WorkBuddy 已验收。
