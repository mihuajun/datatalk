# MCP 文件开发链路（第一阶段，0.4.0）

## 状态与边界

本阶段实现 **本地编辑 → 原始文件传输 → 云端隔离源码快照预览 → MCP 提交正式草稿**。
不依赖 Skill，不发布报表、不启用分享、不下发数据库凭据。客户端是否能够自动操作文件/运行传输工具，必须分别实测；服务端支持不等于 WorkBuddy 已完成验收。

- 不是本地动态预览：`server.js` 仍在云端执行，复用现有 `reportRuntime.query` / `context.query`。
- “隔离”仅指源码目录和请求级路径，不是计算进程或不可信代码沙箱。既有运行时使用 `new Function`，只适用于当前允许编写报表服务端代码的受信开发者。对不可信代码提供宿主隔离需另行实现；本功能不降低原访问角色门槛。
- 首期只接收白名单 UTF-8 源码/文本文件（含 SVG、JSON、CSV）；512 KiB/文件、30 个上传文件、上传总量 16 MiB。基线最多100个文件/16MiB。ZIP、PNG、字体、Excel 等二进制资源不支持。发现基线 data/assets/components 内不支持资源时拒绝，不静默丢弃。
- 暂不新增依赖安装、npm 脚本运行、任意本机路径读取或跨租户迁移。
- 部署时需要现有共享工作区持久卷；多实例须访问同一工作区。会话文件不应放进 Git、报表发布快照或对外下载包。

## MCP 工具

1. `get_studio_context`：读取 `fileDevelopmentContract`、身份、权限和文件约定。
2. `read_report` / `read_report_metric_bindings`：读取当前版本及固定指标版本。新报表仍先 `create_report`。
3. `begin_report_development`：参数为 `reportCode/baseCommitHash/operationId/files/deleteFiles?`。每个 files 元素只有 `{path,size,sha256}`，不含源码。
   - 建立干净基线快照，返回 `sessionId`、基线清单和临时 `transfer.endpoint/authorization`。
   - 若需要先下载完整基线，files 可为空。下载结束关闭此会话；本地编辑并计算变更清单后创建新会话。仍以下载时的 baseCommitHash 为基线，冲突则重新读取/合并，不静默覆盖。
   - 会话最长1小时；报表最多8个会话。新建时清理过期会话，可主动 close 立即清理。
4. 文件通道：`GET endpoint?path=<编码路径>` 下载基线字节；`PUT endpoint?path=...` 上传清单中声明的字节，`Authorization` 为临时凭据，`Content-Type: application/octet-stream`。不接受 URL 查询参数携带凭据；不跟随重定向。重复上传相同内容安全。
5. `inspect_report_development`：校验并生成不可变开发快照和只读预览地址。预览凭据在 URL fragment 中，页面加载后清除 fragment，保留在父页面闭包中，不能上传或提交；10分钟有效且受会话期限约束。关闭页面后重新打开需重新取得链接，禁止公开分享。
6. `commit_report_development`：传 `sessionId/reportCode/operationId/message/expectedReportName?`。复用原 `apply_report_changes` 的锁、Git 基线检查、指标事务、失败回滚及幂等机制。上传授权无法调用提交；必须通过原 MCP 身份。仅更新清单文件和明确删除项。
7. `read_report` + `inspect_report`：检查正式草稿版本、绑定和云端运行结果。成功提交不等于数据准确或视觉验收通过。最后 `close_report_development` 撤销临时传输/预览能力。

## 原样文件与运行一致性

对每个文件校验原始字节数和 SHA-256；UTF-8 解码失败/NUL、哈希不符、超限、越界/重复路径均拒绝。上传只写内容寻址的临时文件；预览基于不可变基线加声明变更，未提交前不改变正式目录或数据库报表状态。

文件提交模式不重写 `report.json.updatedAt` 或 JSON 格式，保留 CRLF、空白和文本字节；版本时间由已有 Git/数据库记录。原 JSON 提交行为保持兼容。发布阶段现有平台行为独立，不在本阶段承诺“发布目录任意文件完全不变”。

使用相同运行时不保证不同时间查询的数据相同。核对时固定统计期、过滤和指标版本；精确复算需数据快照/稳定截止时间。预览结构校验返回 `data:not_checked,visual:not_checked`，不能作为准确性证明。

## 文件助手（不是 Skill）

`node scripts/studio-report-files.mjs`，Node >=22，仅标准库，不安装包、不读取数据库密码。

```sh
# session.credentials.json 是 MCP begin 结果，不要复制到报表目录或提交 Git。
chmod 600 /secure/session.credentials.json
node scripts/studio-report-files.mjs pull /secure/session.credentials.json /local/report
# 编辑本地文件后生成清单，再交给 MCP begin 创建新的上传会话。
node scripts/studio-report-files.mjs manifest /local/report page.html app.js server.js
node scripts/studio-report-files.mjs push /secure/upload-session.credentials.json /local/report
```

下载不覆盖不同内容的本地文件；拒绝符号链接；上传前再次比对清单，编辑后内容变化必须创建新清单/会话。助手只打印文件名和字节数，不打印临时授权。无通用终端/文件传输能力的客户端继续使用 JSON 工具，不能用 Base64 冒充原始文件上传。

## 安全与后续工作

传输和预览每次重新验证来源 OAuth grant/API Key、当前账号状态、权限及报表归属；原授权撤销后立即失效。只读查询仍走现有 SQL 网关。预览父页与报表 iframe 隔离；只接受来自该 iframe 的查询消息，凭据不进入源码或 iframe。文件传输拒绝跨站 Origin。

后续：生产基线构建与部署验收、WorkBuddy 文件传输实测、完整浏览器渲染检查、二进制资源方案、真正本地运行时/热更新，以及更强的服务端代码隔离。本阶段不应被描述为上述能力已完成。

## 0.5.0：本地编辑、本地动态预览、验证后显式上传

默认工作流替换为：

1. `read_report` 记录版本和源码；`prepare_report_local_preview` 传入版本及实际需要的数据源名称白名单（不需要DB则空数组）。此会话上传清单始终为空。
2. 将返回对象保存在源码目录外的 `*.credentials.json`，权限 0600。下载 `localRuntime.url`，**核对返回的 SHA256 后**运行；这是 MCP 管理的普通 Node 运行时，不是 Skill。需要 Node >=22.5。
3. `node studio-report-local.cjs pull <credentials> <workspace>`；已有本地修改不会被覆盖。
4. `node studio-report-local.cjs serve <credentials> <workspace> [port]`，在 WorkBuddy 可见原生终端中前台持续运行，或使用客户端正式提供的受管持久任务，立即在 WorkBuddy 打开返回的完整 `http://127.0.0.1:<port>/#token=...`。token只允许留在本机临时control文件/预览父页，不写入源码、日志或最终回复。
5. 修改本地 HTML/CSS/JS/server.js，点击“刷新本地文件”。报表源码和handler从本地重新加载，**不会自动调用上传、提交或云端开发预览**。旧页面调用已变化handler会得到“请刷新本地文件”，避免前后端不同版本混用。
6. `node studio-report-local.cjs status <control.json>` 读取本地调用统计；`inspect_report_local_preview_boundary` 读取云端版本、逐文件hash及upload blob数。提交前必须 `cloudDraftUnchanged=true` 且 `uploadedBlobs=0`。
7. 本地验证通过才 `manifest <workspace> <changed-files...>` → MCP `begin_report_development` → `push` → `commit_report_development`。仍复用原样字节校验、并发版本检查、指标事务、Git提交；不发布。
8. 回读核对，必要时用正式草稿预览做云端一致性验证；关闭所有会话。`stop <control.json>` 关闭本地服务，并清理本任务凭据/control文件（保留源文件与无敏感信息的证据）。

### 动态数据与安全边界

- 本地与云端共享 `lib/report-handler-runtime.ts` 的模块求值、handler、参数及筛选语义，并复用 `composeWebReportSrcDoc`。支持 CommonJS `server.js`、JSON/CSV/TSV数据文件。现阶段文本传输不包含 `server.ts`、Excel、ZIP和二进制图片。
- 本地worker执行handler。`context.query` 把数据源名称、SQL、绑定参数和限制发送到专用查询网关；**不发送页面、server.js或其他源码**。调用无query的handler时完全不访问云端。
- 查询凭据与下载凭据分离。查询凭据绑定租户/用户/原API key或OAuth grant/报表/数据源白名单；每次重新检查上游身份和query权限。禁止源文件payload、写入查询、跨租户/未授权数据源。凭据不能上传文件或提交草稿；数据库连接凭据留在服务端。
- 会话1小时有效。超时/撤销后查询失败，不静默使用过期数据；重新prepare后保留本地源码，用新凭据重启serve。没有缓存回退。
- 本地服务只监听127.0.0.1，校验Host/Origin和随机会话令牌；报表在sandbox iframe内，凭据只在父进程。worker有超时/内存边界，**不是不可信或恶意代码的安全沙箱**。
- `status`的无上传计数描述本地预览进程本身；云端未变必须结合boundary及MCP操作记录检查，不能只相信本地统计。
- 新建草稿会创建初始模板版本；“提交前不改变草稿”以首次创建并下载后的基线为比较点。


### 0.5.1 WorkBuddy 进程生命周期修正

不要用脱离 execution attempt 的 detached/unref 子进程承载预览，也不得删除 NODE_OPTIONS、PYTHONPATH 或其他客户端保护变量。过期的 brokered-fs 会导致首页200但文件读取失败；这不是浏览器或鉴权问题。应在 WorkBuddy 右侧“新标签页 → 打开终端”中前台运行serve，保留终端直到验收结束，或使用客户端正式支持的长运行任务。Worker继承启动环境和客户端控制，不主动清空环境。

验收必须确认真实页面可见、A/B交互正确、status里的snapshots/handlerCalls增长；仅启动成功、HTTP200或打开链接均不算通过。进程持续期间由MCP读取/校验云端基线；本地验证通过才显式上传。
