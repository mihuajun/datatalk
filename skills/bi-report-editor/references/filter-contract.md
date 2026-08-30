# 筛选器契约

仅在任务涉及新增、删除或修改筛选器、默认值、URL 参数、动态选项、搜索、多选或级联依赖时读取本文件。

## 默认规则：筛选器可由 URL 初始化

所有新建或修改的筛选器默认都必须支持 URL 查询参数。除非用户明确要求禁止 URL 控制，否则每个筛选器都要声明 `urlKey`，并按下面的优先级工作：

1. 有效的 URL 参数值覆盖 `defaultValue`，作为页面首次加载值。
2. 没有 URL 参数时使用 `defaultValue`。
3. 用户修改页面组件后，组件产生的交互值覆盖 URL 初始值，并用于后续查询。

宿主统一负责 URL 参数的解析、类型校验、默认值覆盖、预览/发布页面注入和运行时传递。报表开发人员仍必须负责把注入值绑定到页面组件、把最新组件状态传入 `window.reportRuntime.query`，以及在 `server.js` 中把筛选值映射到 SQL/REST 参数。skill 约束的是开发时必须完成这条链路，不能从任意自由编写的 HTML/JavaScript 中自动推断组件绑定关系。

## 事实来源

当前宿主只从 `working/report.json` 根节点读取 `filters` 数组，并用它：

- 生成编辑器右侧属性面板的筛选清单；
- 解析预览、查看和公共链接中的 URL 参数；
- 向报表页面注入默认筛选值；
- 约束 `window.reportRuntime.query(dataId, filters)` 最终传给 `server.js` 的参数。

`filter.json`、`filters.json`、`page.json` 不是当前宿主的筛选入口。不要创建或修改这些文件来声明筛选器。JSON 语法正确、文件成功提交或页面上出现控件，都不能证明宿主已经识别筛选器。

## 清单结构

在保留 `report.json` 原有元信息的前提下，合并或更新根节点 `filters`：

```json
{
  "filters": [
    {
      "key": "startDate",
      "urlKey": "startDate",
      "label": "开始日期",
      "type": "date",
      "defaultValue": "2026-08-01",
      "visible": true
    },
    {
      "key": "projectNames",
      "urlKey": "projectNames",
      "label": "项目名称",
      "type": "multiSelect",
      "defaultValue": [],
      "visible": true
    },
    {
      "key": "projectSearch",
      "urlKey": "projectSearch",
      "label": "项目搜索词",
      "type": "text",
      "defaultValue": "",
      "visible": false
    }
  ]
}
```

不要用这个片段覆盖整个 `report.json`。必须保留现有的 `schemaVersion`、`reportCode`、`tenantId`、`name`、`entry`、`format`、`updatedAt` 和其他已有字段。

每个筛选项明确填写：

- `key`：报表内唯一，使用英文字母、数字、下划线或连字符。它是 `app.js` 和 `server.js` 使用的标准参数名。
- `urlKey`：URL 查询参数名，通常与 `key` 相同。
- `label`：属性面板和页面使用的业务名称。
- `type`：仅使用 `text`、`number`、`boolean`、`date`、`dateRange`、`select`、`multiSelect`。
- `defaultValue`：类型匹配的默认值。多选使用字符串或数字数组，布尔值使用布尔类型，数字使用数值类型；无默认值使用空字符串或 `null`。
- `visible`：宿主侧可见性声明。页面控件是否实际显示仍由 `page.html` 和 `app.js` 控制。
- `options`：可选的静态选项，格式为 `[{ "value": ..., "label": ... }]`。动态选项不必写入静态列表。

预览、已发布查看和公共链接会先用 URL 参数覆盖 `defaultValue`，再把结果注入 `window.__DATATALK_REPORT_CONTEXT__.filters`。页面首次查询时，如果传入值仍等于清单中的默认值，宿主会保留 URL 覆盖值；页面控件产生不同的新值后，该交互值可以覆盖 URL 初始值。

## `app.js` 标准接入模式

页面不要直接从 `location.search` 解析业务筛选值，也不要在多个组件中各自维护一份初始值。统一使用宿主注入的最终值初始化一份状态，并在每次查询时传入这份状态：

```js
const reportContext = window.__DATATALK_REPORT_CONTEXT__ || {};
const filterState = { ...(reportContext.filters || {}) };

async function loadSummary() {
  const data = await window.reportRuntime.query("sales-summary", { ...filterState });
  renderSummary(data);
}

function onRegionChange(value) {
  filterState.region = value;
  void loadSummary();
}
```

组件初始值应读取 `filterState` 对应的 `key`，而不是重新写死 `defaultValue`。如果筛选器是多选，页面状态、`query` 入参和 URL 参数都保持数组语义；如果是日期、数字或布尔值，保持契约声明的类型。`urlFilters` 仅用于需要区分“URL 初始值”和“当前最终值”的特殊交互，不应替代 `filters` 作为普通组件初始状态。

## 参数联动

同一个筛选器必须在以下位置使用完全一致的 `key`：

- `report.json.filters[*].key`；
- `page.html` 对应控件的标识或绑定；
- `app.js` 传给 `window.reportRuntime.query(dataId, filters)` 的对象键；
- `server.js` handler 从 `filters` 读取的对象键；
- SQL 命名参数或 REST 查询参数的映射键。

一旦 `report.json.filters` 存在，未声明的运行时参数会被过滤掉。动态选项查询使用的搜索词、页码、每页数量、选项类型、父级筛选值等参数，也必须加入清单；不希望作为普通页面筛选展示的参数设置 `visible: false`。

级联筛选还必须保证：

- 父级变化时清除不再有效的子级选择；
- 使用新的父级值重新加载子级选项；
- 多选值保持数组形态，不在页面、URL、运行时之间随意改成不兼容的分隔字符串；
- `server.js` 对空值、默认值和无结果状态有明确处理。

## 修改步骤

1. 读取现有 `report.json`、`page.html`、`app.js`、`server.js`，列出声明键、URL 键、页面键、发送键和消费键。
2. 在现有 `report.json` 根节点合并筛选项，保留所有元信息；每个新筛选器都填写 `urlKey`、类型匹配的 `defaultValue`，并按需求同步页面控件、交互逻辑和服务端处理。
3. 确认页面组件初始值来自 `window.__DATATALK_REPORT_CONTEXT__.filters`，首次查询和后续交互查询都传入同一套筛选键。
4. 对真实数据筛选，确认 SQL/REST 参数与筛选键和数据类型一致，并按主 Skill 要求完成只读预览验证。
5. 写入后重新解析 `report.json`，确认 `filters` 是数组、`key` 和 `urlKey` 无重复、字段类型正确，且没有误建独立筛选 JSON 文件。
6. 验证工作区快照中的 `filterManifest` 包含新条目，右侧属性面板显示对应筛选项，并实际执行默认值、URL 值、组件交互值和无结果场景。

不能只以“JSON 格式正确”“文件已写入”“语法检查通过”或 AI 的文字说明作为完成依据。

## URL 参数验收清单

每个新增或修改的筛选器至少验证以下场景：

- 不带 URL 参数：页面控件和请求使用 `defaultValue`。
- 带有效 URL 参数：页面首次控件状态和首次请求使用 URL 值，而不是 `defaultValue`。
- URL 参数无效或类型错误：使用明确的默认/空值策略，不能把错误值直接传给查询。
- 用户修改组件：后续请求使用交互值，不被原始 URL 值覆盖。
- 预览、已发布查看和公共链接：同一 `urlKey` 的行为一致。
- 多值筛选器：重复查询参数和页面数组值保持一致，并验证空数组和无结果状态。
