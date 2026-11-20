# 指标语义 v2：完整纯文本、固定版本与检索

## 权威结构

`content` 为唯一权威语义，不再存在指标的 `definition_json`。SQL/公式不是数据库独立语义列，模型读取完整正文决定如何使用。正文约定见 `skills/bi-metric-knowledge/SKILL.md`，覆盖业务定义、真实表字段、关联、聚合、时间、过滤、去重、维度、单位、SQL 示例、未知项。

| 表 | 职责 |
|---|---|
| tenant_metric_knowledge | tenant_id + metric_key 唯一；name、aliases_json、keywords_json、content、status、version、created_by/updated_by、created_at/updated_at；规范化名称、search_text、fingerprint 是辅助字段；来源和反馈计数用于审计 |
| tenant_metric_knowledge_version | tenant_id + metric_key + version 不可覆盖快照；name、aliases_json、keywords_json、content、变更说明和作者/时间 |
| tenant_report_metric_binding | tenant_id + report_code + metric_key 唯一；metric_version 固定到真实使用版本；从报表表读取当前报表名称 |
| tenant_metric_search_index | tenant_id + metric_key + version 的可重建缓存；embedding_json、模型身份、content_hash、更新时间；不作为定义 |
| report_metric_knowledge_proposal | 候选工作流：content、关键词、别名、previous_json 基线、confirmed、validated、状态和失败原因；不会参加正式召回 |

创建人不等于独立业务负责人，页面明确标为创建人。报表绑定记录当前实际使用关系；历史修改追溯到已有报表 Git/审计，不把当前绑定表称为完整“所有使用过”的事件日志。

## 状态、写入、版本

- 正式指标支持 `active ↔ disabled`（启用 / 禁用），也可归档为 `archived`，归档后可恢复为 `active`；仅无在用报表引用的已归档指标可删除为 `deleted`。
- “有效”页签保留启用和禁用的正式指标，操作列提供启用 / 禁用及归档。禁用指标不参与新的关键词或向量召回，但不删除历史版本、向量和已有报表绑定；状态切换不生成内容版本。
- 待处理草稿属于候选，未审核内容不会混在正式指标内。
- 提交接口必需 name、content、baseVersion；aliases/keywords 可选，更新时省略则沿用。
- content 最大 60000 字符，完整保留 SQL 运算符、大小写及标点；不对原文做破坏性规范化。
- confirmed 和本候选 SQL 实际执行校验是独立门槛。SQL 能执行不等于业务正确，也不证明正文与 SQL 语义一致，仍需使用者核对。
- 报表 Git 提交审计成功后，版本、主表、绑定、候选结果在同一数据库事务中生效。Git 与数据库不是分布式原子事务；失败返回 pending，不伪称发布。
- 名称/别名/关键词/正文改变都形成新版本，旧报表不自动升级。仅复用不改变定义更新时间。
- `metricBindings` 是完整清单，未声明保持原绑定，空数组显式解绑。归档旧版本只允许保留已有绑定，不允许新引用。

## 检索与模型输入

1. SQL 先限制 tenant_id 和 active 状态。
2. 名称/key/别名精确匹配优先；keywords 与完整 content 参加关键词召回。
3. 向量文本为名称、别名、关键词及完整 content；模型身份、内容 hash 或维度不匹配的缓存不参加召回。
4. 混合 RRF 排序；响应包含 metricKey、name、version、keywords、完整 content、匹配依据和检索降级状态。
5. `requiresContentReview=true`：不把名称精确命中或向量相似当成业务正确性证明；传入旧式口径 hints 时提示核对正文，不再假装做结构化字段等价判断。
6. 不依赖正文标题解析取数逻辑。模型读原文，实际查询仍走既有只读、权限和结果限制。

向量在系统设置的现有配置启用。失败不回滚正式定义；可用 `npm run metrics:reindex -- <tenantId>` 重建。配置密钥不进入指标表或响应。

## 清空重建，不迁移历史

用户确认所有历史指标都是示例数据，不需要兼容。直接重建原名的五张指标表，不迁移旧 JSON，不保留并行兼容表。旧结构启动报 `METRIC_SCHEMA_RESET_REQUIRED`，正常启动不会擅自删库。

1. `npm run db:reset-metric-content -- --all-tenants` 只读预览，返回目标表条数及摘要，不暴露连接信息。
2. 停止使用旧结构的应用写入，核对范围。
3. `npm run db:reset-metric-content -- --execute --all-tenants --digest=<预览摘要>` 才执行。摘要变化则拒绝；未明确传 `--all-tenants` 时，其他租户存在指标数据会拒绝；存在正式报表绑定也会拒绝，不能静默清空其他租户或留下旧报表悬空引用。
4. 仅重建五张指标表，清理 knowledge_type=metric 的旧反馈。报表、发布记录、资源与数据源逐表内容摘要验证不变。保留权限 0600 的一次性回退备份，不将其当迁移来源。
5. MySQL DDL 非原子；失败时保留备份，需维护窗口人工恢复。禁止在仍有旧版本应用写入时执行。旧初始化/迁移命令已停用，避免再次建 JSON 结构。

新安装直接初始化新结构。测试使用隔离 SQLite；MySQL 测试使用连接级 TEMPORARY 表，不改共享表。

## 验证入口

- `npm run test:metric-content`：自动创建隔离 SQLite，验证纯文本存储、关键词版本和重建边界。
- `test:metric-knowledge`、`test:metric-retrieval`：必须提供隔离 `STUDIO_CONFIG_PATH`，不要指向共享业务库。
- `npm run test:metric-mysql`：只用连接级临时表，模型配置隔离，不调用真实向量服务。
- `npm run test:metric-real-embedding`：显式使用已配置真实向量服务和合成文本，仅 MySQL 临时表写入。
- `test:metric-http`：隔离应用真实登录、查询、Git 和发布流程。
- `scripts/verify-metric-browser.mjs`：以 `METRIC_FIXTURE_ROOT` 指向 HTTP 验收数据，验证桌面和移动端。
