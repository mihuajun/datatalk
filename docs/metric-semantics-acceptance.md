# 指标纯文本语义重建验收（当前）

日期：2026-10-24。用户确认历史指标均为示例，不要求兼容或迁移。

## 已交付

- 原名五张指标表直接重建，无并行兼容表；主表、候选、版本存 `content` 和 `keywords_json`，不再存 `definition_json`。
- 正式状态为 active/archived/deleted，候选保持独立发布门槛。
- 名称、别名、关键词、完整正文可检索；模型直接获得完整原文、固定版本及匹配依据。
- 内置 Agent 插件、外部工具 schema、管理页面、Skill 内容模板同步；运行时文件 SHA 与源码一致。
- 历史正文、别名和关键词按版本保存；报表之间不自动升级。

## 当前配置数据库与应用

- MySQL 已执行重建：旧候选 **28 → 0**；正式指标、版本、引用、向量索引当前均为 0。
- 重建前后 tenant_report、report_release、resource_item、tenant_data_source 的整表内容摘要一致。
- 仅保留一次性的本地应急快照，不迁移旧记录、不保留兼容读写链路。
- 本地应用已重启，入口 `http://localhost:3000/metrics`；真实登录、API HTTP 200、空指标/空候选页面已确认。
- 没有发布线上应用镜像。数据库重建状态与线上应用部署状态不能混为一谈。

## 全流程证据

| 验证 | 结果 |
|---|---|
| TypeScript、补丁检查、生产 build | 通过 |
| SQLite 指标生命周期 | 创建、复用、修订、并发冲突、归档恢复、删除保护、解绑和事务回滚通过 |
| MySQL 临时表生命周期 | 同套逻辑通过；长中文正文与 search_text 不截断；不向共享业务表写测试记录 |
| 内容存储与重建 | SQL 运算符/标点/附加段落原样回读；关键词变更生成新版本；旧 JSON 重建、预览摘要、租户范围保护、报表保护通过 |
| 真实 HTTP 链路 | 登录 → API Key → 创建两份隔离报表 → 实际业务 SQLite SQL 校验（v1=2000、v2=1800）→ 候选 → report.json 完整引用 → Git 提交 → 版本发布 → 第二份复用 → 第一份升 v2、第二份固定 v1 → 历史读取通过 |
| 失败分支 | 缺正文 400；错误 SQL 422 且不创建候选；旧 baseVersion 409；未确认/未校验不得成为正式指标 |
| 确定性向量测试 | 真实 HTTP fixture、向量独立召回、关键词降级、禁用零请求、模型变化失效、租户/归档隔离通过 |
| 已配置的真实向量服务 | 合成测试正文获得 **2048 维**向量；MySQL 临时表写入/读取索引、真实 query embedding、混合召回、完整 content 回传均通过；不是仅测连接 |
| 浏览器 | Chrome 桌面/390px 移动端显示完整正文、版本历史和两份报表绑定；归档、恢复、在用删除保护通过；无 pageerror |

测试数据仅存在隔离 SQLite / MySQL 连接级 TEMPORARY 表。真实向量服务只收到合成验收文本，不含客户数据。上述测试验证确定性工具链路，不冒充自然语言模型自主生成效果的评测。

证据：`.workbuddy-local/metric-content-v2/` 下 reset-result.log、shared-verification.json、shared-browser.json、real-embedding.json 和各 *-final.log；浏览器截图在 `.workbuddy-local/metric-governance/content-final/`。

---

## 以下为重建前的历史验收记录，不代表当前数据结构或状态

# 指标语义改造验收记录

日期：2026-10-24。区分代码测试、真实应用链路、共享库迁移和外部服务状态。

## 已通过

| 项目 | 证据与边界 |
|---|---|
| TypeScript 与补丁检查 | `npm run typecheck`、`git diff --check` |
| 生命周期回归 | SQLite 和 MySQL 临时表分别通过创建、复用、修订、草稿门槛、并发冲突、归档/恢复、软删除、版本固定、明确解绑与回滚 |
| 冲突保护 | 旧候选不能因为版本号相同而绑定另一作者的新定义；未被完整引用清单采用的候选不发布 |
| 历史迁移 | 临时 SQLite 验证当前定义优先、旧版本补齐、最新引用迁移、重复迁移不复活解绑记录、保留归档状态 |
| 混合检索 | 本地 HTTP embedding fixture 验证向量独立召回、关键词兜底、粒度/维度冲突、租户隔离、归档排除、模型变化和服务失败降级 |
| 实际 HTTP 流程 | 隔离 Studio：真实登录与 API Key 鉴权、业务 SQLite 查询校验、Git 提交、两份报表复用、其中一份升级 v2、另一份保持 v1、归档与引用删除保护 |
| Chrome 页面 | 实际渲染、打开详情、展开历史定义、查看两份报表及各自版本、归档、删除被阻止并展示原因、恢复；无浏览器 pageerror |
| 共享库迁移 | 用户确认后先备份再增量迁移；原 28 条候选逐字段比对无变化、无丢失；迁移前后正式指标均为 0，没有自动发布草稿 |

测试报表仅存在于 `.workbuddy-local/metric-governance` 隔离数据库及工作区，没有写入共享业务库。MySQL 回归使用连接级临时表，连接关闭后自动释放；真实共享库只执行已确认的增量结构迁移。

## 当前运行与未完成项

- 新版本地应用使用原配置连接共享库，入口 `http://localhost:3000/metrics`。
- 数据库结构已迁移，不代表线上应用代码已经发布；此次未发布线上应用。
- 未提供真实 embedding 服务配置，因此本地真实调用目前明确降级为关键词检索。
- 本地 embedding fixture 只证明协议与排序/隔离/降级链路，不代表真实模型效果。取得服务配置后还需要对业务近义问法完成真实召回验收。
- 当前检索使用租户内精确扫描，不是 ANN 向量检索集群；没有新增后台索引任务队列。

## 可视证据

隔离 Chrome 截图保存在 `.workbuddy-local/metric-governance/`：

- `metric-list.png`
- `metric-detail.png`
- `metric-delete-guard.png`
- `metric-settings.png`

首份共享库迁移备份：`.workbuddy-local/metric-governance/backups/metrics-2026-10-24T02-41-23-329Z.json`。

具体存储职责、工具契约、迁移和重建索引命令见 `metric-semantics-governance.md`。

## 向量模型系统设置补充验收

- 新增「系统设置 → 模型配置 → 向量模型」，默认关闭，保存立即生效；关闭后不会因旧环境变量配置而调用向量服务。
- 系统管理员权限、连接测试、API Key 不回传、启用重建、关闭无请求、刷新后状态持久化均使用隔离 SQLite 与本地 HTTP fixture 验证。
- 实际生产 embedding 服务尚未配置；本地 fixture 验证的是调用与控制逻辑，不代表模型召回质量测评。
