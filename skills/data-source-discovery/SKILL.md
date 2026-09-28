---
name: data-source-discovery
description: 为涉及统计、经济、金融、贸易、人口、健康、能源、农业、劳动、教育和环境数据的任务，优先从专门的数据平台和官方数据源发现资料；先按主题路由到权威网站，再使用限定域名的 Web Search，不把普通搜索结果或聚合站摘要当作最终事实来源。
---

# 专门数据源发现

你负责为当前任务选择合适的数据网站。这个 Skill 解决的是“去哪里找数据”，不是凭记忆回答数据值。

## 基本原则

1. 涉及当前数据、历史统计、时间序列、地区比较、指标定义或数据下载时，优先加载本 Skill，并使用 `web-search` Skill 和 `datatalk-web-search` 工具。
2. 先根据主题、国家/地区、时间频率和指标类型选择专门数据平台，再进行搜索。不要先做无域名限制的泛搜索。
3. 来源优先级为：数据生产机构的官方平台 > 国际组织或官方统计机构的汇总平台 > 有明确来源和元数据的专业聚合平台 > 普通网页、新闻、博客和搜索摘要。
4. 搜索结果中的摘要只能用于发现页面，不能单独作为数字、单位、口径或发布时间的证据。
5. 最终回答数字时，必须尽量给出数据平台、具体页面或 API、指标名称、地区、时间范围、单位和访问时间。
6. 找不到专门数据源时，明确说明“未找到权威结构化数据”，再退回到普通网页搜索；不得把搜索结果包装成官方数据。
7. 用户指定数据源时优先遵守，但如果该来源不是原始生产机构，要同时寻找并说明其上游来源。
8. 企业内部、私有 API、需要登录的数据平台不通过公共 Web Search 猜测或绕过访问；应使用当前租户的数据源和权限。

## 任务分类

先从用户问题中识别以下维度：

- 主题：宏观经济、金融、贸易、人口、健康、劳动、教育、农业、能源、环境、企业披露或地理。
- 范围：中国、某个国家/地区、欧盟、全球或跨国比较。
- 频率：日、周、月、季度、年度、普查或一次性快照。
- 指标形态：水平值、增长率、指数、占比、排名、流量、存量、估计值或预测值。
- 口径：名义/实际、现价/不变价、季调/未季调、当期/累计、自然年/财年、官方值/估计值。

如果指标、频率、地区、单位或口径有歧义，先澄清最关键的一项。不要把“GDP”“GDP 增速”“人均 GDP”和“GDP 占比”当作同一个指标。

## 中国数据源

| 主题 | 首选数据平台 | 入口域名 | 使用说明 |
| --- | --- | --- | --- |
| 综合宏观、人口、价格、收入、产业、地区统计 | 国家统计局国家数据 | `data.stats.gov.cn` | 首选中国宏观和地区统计；优先寻找数据发布库、查询表和指标定义。 |
| 统计制度、统计公报、年鉴和解释 | 国家统计局 | `stats.gov.cn` | 用于确认口径、统计制度、新闻发布和官方解释；不能只引用新闻标题中的数字。 |
| 货币、信贷、金融机构、利率、外汇和支付 | 中国人民银行 | `pbc.gov.cn` | 优先使用“统计数据”和对应的金融统计口径。 |
| 进出口、商品、贸易方式和国别/地区 | 海关总署 | `online.customs.gov.cn`、`english.customs.gov.cn/Statistics/Statistics` | 优先海关统计数据查询、月度/季度发布和说明；注意海关口径与国际收支口径不同。 |
| 电力、能源生产、装机、用电量 | 国家能源局 | `nea.gov.cn` | 优先统计信息、统计数据和正式发布；能源数据应保留发布期和累计/当期口径。 |
| 财政收支、中央和地方预算 | 财政部 | `mof.gov.cn` | 优先财政收支统计、预算执行和决算文件。 |
| 卫生资源、医疗服务、疾病和健康统计 | 国家卫生健康委 | `nhc.gov.cn` | 先区分行政统计、监测数据和估计值；必要时与 WHO 口径分开。 |
| 上市公司公告、财务报表和定期报告 | 巨潮资讯、上交所、深交所 | `cninfo.com.cn`、`sse.com.cn`、`szse.cn` | 作为中国上市公司披露的优先来源；公告日期、报告期和合并口径必须保留。 |

中国数据的推荐搜索模板：

```text
site:data.stats.gov.cn <指标> <地区> <年份或月份>
site:stats.gov.cn <指标> 统计公报 <年份>
site:pbc.gov.cn <指标> 统计数据 <年份或月份>
site:online.customs.gov.cn 海关统计 <商品或国家> <年份>
site:nea.gov.cn <能源指标> 统计数据 <年份或月份>
site:cninfo.com.cn <公司名称> <报告期> <指标>
```

## 国际综合数据源

| 主题 | 首选数据平台 | 入口域名 | 使用说明 |
| --- | --- | --- | --- |
| 全球发展、人口、贫困、教育、健康、经济 | World Bank Open Data | `data.worldbank.org`、`api.worldbank.org` | 适合跨国长期时间序列；优先使用指标代码、国家代码、年份和 API 元数据。World Bank Indicators API v2 不需要 API Key。 |
| 国际收支、财政、通胀、汇率、债务、宏观金融 | IMF Data | `data.imf.org`、`api.imf.org` | 优先使用 IMF Data Portal 和 SDMX 2.1/3.0；要保留数据集、维度和版本信息。 |
| OECD 成员国和伙伴经济体的经济、社会、教育、环境 | OECD Data Explorer | `data-explorer.oecd.org`、`oecd.org/en/data` | 优先使用 Data Explorer 的数据集、元数据和 API；不要把 OECD 估计值默认当作各国官方值。 |
| 全球可持续发展目标 | UN SDG Data Portal | `unstats.un.org/sdgs/dataportal` | 适合 SDG 指标、目标、国家和地区比较；保留指标代码、目标编号和估计/报告标记。 |
| 全球贸易商品明细 | UN Comtrade | `comtrade.un.org`、`comtradeplus.un.org`、`comtradeapi.un.org` | 适合商品、报告国、伙伴国、贸易流向和 HS/SITC 分类；注意免费预览、API 限制、修订和报告国缺失。 |
| 国际贸易、关税、服务贸易和市场准入 | WTO Data | `data.wto.org`、`stats.wto.org` | 适合 WTO 统计、关税和贸易服务；注意部分数据为 WTO 汇总或估计，不一定是原始申报值。 |
| 国际金融、银行、债券、信贷、汇率和房价 | BIS Data Portal | `bis.org/statistics`、`data.bis.org`、`stats.bis.org` | 适合金融稳定和全球金融体系；优先使用数据集、元数据和 SDMX API。 |
| 欧盟及成员国官方统计 | Eurostat | `ec.europa.eu/eurostat/data/database` | 优先使用详细数据集、元数据、代码表和下载格式；注意观测状态、估计、预测、缺失和保密标记。 |

国际数据的推荐搜索模板：

```text
site:data.worldbank.org <indicator> <country>
site:api.worldbank.org/v2 <indicator code> <country code>
site:data.imf.org <indicator> <country> <frequency>
site:data-explorer.oecd.org <indicator> <country>
site:unstats.un.org/sdgs/dataportal <SDG indicator>
site:comtrade.un.org <commodity> <reporter> <partner> <year>
site:data.wto.org <trade indicator> <country>
site:ec.europa.eu/eurostat <indicator> <EU country>
```

## 主题数据源

| 主题 | 首选数据平台 | 入口域名 | 使用说明 |
| --- | --- | --- | --- |
| 全球健康、死亡率、疾病、卫生系统 | WHO Global Health Observatory | `who.int/data/gho`、`ghoapi.azureedge.net` | GHO 提供 OData API；明确区分 WHO 估计值与各国官方估计。 |
| 全球劳动、就业、工资和工时 | ILOSTAT | `ilostat.ilo.org/data` | 优先 ILOSTAT 数据浏览器、指标元数据和下载；保留劳动统计的定义和覆盖范围。 |
| 粮食、农业、土地、渔业和林业 | FAOSTAT | `fao.org/faostat/en` | 优先 FAOSTAT 数据库和下载；注意估算值、插补值、单位和农业分类。 |
| 美国人口、社区、住房、企业和地区 | U.S. Census Bureau | `census.gov/data`、`api.census.gov` | 优先 Census Data API 和变量说明；地理层级、FIPS、参考年份必须明确。 |
| 美国劳动、就业、CPI 和工资 | U.S. Bureau of Labor Statistics | `bls.gov/data`、`api.bls.gov` | 优先 BLS 数据工具和 API；保留 series ID、季调标志、脚注和初值/修订状态。 |
| 美国国民账户、GDP、收入和产业 | U.S. Bureau of Economic Analysis | `bea.gov`、`apps.bea.gov` | 优先 BEA 数据和 API 文档；注意 current/real、季调和年化率。 |
| 美国经济时间序列和金融市场宏观数据 | FRED / ALFRED | `fred.stlouisfed.org`、`api.stlouisfed.org` | FRED 是汇总平台；优先查看原始数据源、系列定义、频率、季调和 ALFRED vintage。API 可能需要 Key，不要猜测或暴露凭据。 |
| 美国能源、石油、电力和天然气 | U.S. Energy Information Administration | `eia.gov`、`api.eia.gov` | 优先 EIA 数据浏览器、系列定义和 API；保留能源单位和时间频率。 |
| 美国上市公司申报和财务数据 | SEC EDGAR | `sec.gov/edgar`、`data.sec.gov` | 优先 SEC filings、companyfacts 和 XBRL 定义；CIK、表单类型、报告期和 filing date 必须保留。 |
| 全球气候、天气和环境观测 | NOAA | `noaa.gov`、`ncei.noaa.gov`、`data.noaa.gov` | 优先 NOAA/NCEI 数据和元数据；区分观测、再分析、预测和模型估计。 |

## 专业聚合与发现平台

以下平台可以加速发现、跨源比较或下载，但默认不是第一优先级的原始证据：

| 平台 | 入口域名 | 适用场景 | 使用限制 |
| --- | --- | --- | --- |
| Our World in Data | `ourworldindata.org` | 全球长期趋势、跨国可视化、快速下载 CSV 和元数据 | 查看每个图表的上游来源和许可证；官方来源可用时，最终引用上游官方源。 |
| Google Data Commons | `datacommons.org` | 跨主题实体、地点和指标的快速发现 | 数据来自多个来源；必须查看 provenance，不要把知识图谱结果默认当作原始统计值。 |
| DBnomics | `db.nomics.world` | 查找多个官方机构的经济时间序列和代码 | 作为索引和便捷 API；最终引用对应的生产机构和数据集。 |
| data.europa.eu | `data.europa.eu` | 欧盟开放数据集发现 | 是目录和发现入口；最终数据应回到发布机构或官方数据集页面。 |
| Kaggle | `kaggle.com/datasets` | 探索、教学、机器学习数据集 | 不作为宏观事实或正式报表的默认来源；必须核查原始来源、版本和许可证。 |

## 来源选择规则

### 中国宏观问题

优先顺序：

```text
国家统计局国家数据
-> 国家统计局统计公报/年鉴/统计制度
-> 中国人民银行、财政部、国家能源局等主管部门
-> World Bank / IMF / OECD 作为跨国比较或交叉核验
-> 普通网页搜索
```

### 跨国比较问题

优先顺序：

```text
指标生产机构的国际数据库
-> World Bank / IMF / OECD / UN / Eurostat / WHO / ILO / FAO
-> 各国官方统计机构
-> FRED、OWID、DBnomics 等聚合平台
-> 普通网页搜索
```

### 金融市场和上市公司问题

优先顺序：

```text
交易所、央行、监管机构、公司监管申报
-> 官方公告和财报
-> 官方或受监管的数据平台
-> FRED、BIS、专业聚合平台
-> 财经新闻和普通网页
```

### 医疗健康问题

优先顺序：

```text
本国卫生主管部门或统计机构
-> WHO Global Health Observatory
-> UN / World Bank / OECD
-> 学术或专业聚合平台
```

对于 WHO、World Bank、OECD 等估计数据，明确告诉用户这是国际机构估计或可比口径；不要暗示它一定等于国家官方公布值。

## Web Search 调用规范

1. 先加载 `web-search` Skill。
2. 使用 `datatalk-web-search`，默认 `type: "web"`，优先设置 `authLevel: 1`。
3. 首轮搜索使用一个专门数据平台和一个清晰指标，例如：

```json
{
  "query": "site:data.stats.gov.cn 各省 GDP 增速 2020 2025",
  "type": "web",
  "count": 5,
  "authLevel": 1
}
```

4. 如果首选平台没有结果，再按来源优先级逐级扩大范围；每次扩大范围都要说明。
5. 搜索结果出现多个指标时，比较标题、单位、频率、时间范围和元数据，不要只选最靠前的结果。
6. 对数字类问题至少保留一个具体来源页面；对重要或有争议的数字，增加一个官方交叉来源。
7. 不要在搜索关键词、工具参数或回答中放入 API Key、Cookie、Token 或私有连接信息。

## 数据结果输出规范

临时问答至少给出：

```text
指标名称
数值
单位
地区
时间或参考期
统计频率
来源平台
具体来源 URL
查询或访问时间
```

用户要求做图表、报表或导出时，优先整理为：

```text
period | geography | indicator | value | unit | frequency | source | retrieved_at | note
```

同时保留：

- 原始值和标准化值
- 指标代码、地区代码和分类版本
- 估计、预测、初值、修订、缺失和保密标记
- 数据下载或查询链接
- 口径、单位和方法说明

如果只有文章或 PDF，没有可核验的结构化数据表，说明“当前拿到的是发布内容，不是结构化数据集”，不要虚构精确的逐行数据。

## 报表生成规则

- Web Search 结果可以用于发现数据和生成带来源的临时分析。
- 需要进入报表的数据，必须先形成结构化表格，并记录来源、查询条件和访问时间。
- 不要把搜索摘要直接绑定到图表。
- 不要在没有用户确认的情况下把不同平台、不同单位或不同统计口径的数据合并。
- 如果生成的是固定报告，尽量保留本次数据快照和 fingerprint；如果生成的是动态报告，明确说明数据会随上游修订而变化。

## 失败处理

- 官方平台不可访问：说明访问失败，尝试同一机构的备用官方入口或正式发布页面。
- 官方页面只有图表没有表格：先寻找下载、API、数据表或元数据入口；不要直接从图片读数，除非用户明确接受近似提取。
- 来源之间数字不一致：并列展示来源、时间、单位和口径，解释差异，不要静默选择一个。
- 找不到指标：返回已搜索的平台和关键词，向用户询问指标别名、地区层级、时间频率或统计口径。
- 只有聚合站结果：把它标记为二级来源，并继续寻找上游生产机构。
