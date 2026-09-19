import type { ReportDefinition } from "@/lib/report-types";
import type { ResourceAssetType, ResourceCategoryOption, ResourceCategoryRecommendation } from "@/lib/resource-center-types";
import { requestConfiguredAgentCompletion } from "@/lib/server/agent-runtime";

type RecommendationInput = {
  assetType: ResourceAssetType;
  title: string;
  summary?: string | null;
  reportName?: string | null;
  definition?: ReportDefinition | null;
  categories: ResourceCategoryOption[];
};

type RecommendationRule = {
  codes: string[];
  keywords: string[];
  reason: string;
};

const RECOMMENDATION_RULES: Record<ResourceAssetType, RecommendationRule[]> = {
  report: [
    { codes: ["sales-achievement", "sales-analysis"], keywords: ["销售", "订单", "成交", "销售额", "业绩", "达成"], reason: "标题或指标包含销售、订单或业绩达成信息" },
    { codes: ["regional-sales", "sales-analysis"], keywords: ["区域", "地区", "省份", "城市", "大区"], reason: "内容包含区域维度，适合放在区域销售场景" },
    { codes: ["finance-analysis", "cost-profit"], keywords: ["财务", "收入", "利润", "成本", "现金流", "预算"], reason: "内容包含收入、成本、利润或预算指标" },
    { codes: ["users-customers", "customer-value"], keywords: ["用户", "客户", "会员", "留存", "活跃", "复购"], reason: "内容围绕用户、客户或留存经营" },
    { codes: ["ecommerce-products", "product-analysis"], keywords: ["电商", "商品", "sku", "库存", "门店", "gmv"], reason: "内容包含电商、商品、库存或门店经营信息" },
    { codes: ["marketing-growth", "conversion-analysis"], keywords: ["市场", "营销", "投放", "增长", "转化", "活动"], reason: "内容包含市场投放、增长或转化指标" },
    { codes: ["people-hr", "organization-effectiveness"], keywords: ["人员", "人力", "员工", "招聘", "离职", "组织", "hr"], reason: "内容包含人员、招聘、流失或组织效能信息" },
    { codes: ["supply-operations", "fulfillment"], keywords: ["供应链", "采购", "仓储", "物流", "履约", "交付"], reason: "内容包含采购、仓储、物流或履约信息" },
    { codes: ["industry-public", "industry-research"], keywords: ["行业", "人口", "宏观", "公共", "gdp", "研究", "市场规模"], reason: "内容更偏向行业研究或公共数据分析" },
  ],
  template: [
    { codes: ["sales-achievement", "sales-analysis"], keywords: ["销售", "订单", "成交", "销售额", "业绩", "达成"], reason: "模板适合销售达成和业绩跟踪场景" },
    { codes: ["user-analysis", "active-retention"], keywords: ["用户", "客户", "会员", "留存", "活跃", "复购"], reason: "模板适合用户增长、活跃或留存分析场景" },
    { codes: ["ecommerce-analysis", "ecommerce-overview"], keywords: ["电商", "商品", "sku", "库存", "门店", "gmv"], reason: "模板适合电商、商品或门店经营场景" },
    { codes: ["finance-analysis", "cost-profit"], keywords: ["财务", "收入", "利润", "成本", "现金流", "预算"], reason: "模板适合财务、成本利润或预算管理场景" },
    { codes: ["marketing-analysis", "conversion-analysis"], keywords: ["市场", "营销", "投放", "增长", "转化", "活动"], reason: "模板适合市场营销和增长分析场景" },
    { codes: ["hr-analysis", "organization-structure"], keywords: ["人员", "人力", "员工", "招聘", "离职", "组织", "hr"], reason: "模板适合人员、招聘和组织结构分析场景" },
    { codes: ["supply-chain-analysis", "fulfillment"], keywords: ["供应链", "采购", "仓储", "物流", "履约", "交付"], reason: "模板适合供应链、库存和履约分析场景" },
    { codes: ["product-project", "product-performance"], keywords: ["产品", "项目", "功能", "版本", "里程碑"], reason: "模板适合产品表现或项目进度分析场景" },
    { codes: ["service-operations", "customer-service"], keywords: ["客服", "服务", "工单", "满意度", "运营监控"], reason: "模板适合服务质量和运营监控场景" },
  ],
  dataset: [
    { codes: ["macro-economy"], keywords: ["宏观", "gdp", "经济", "通胀", "利率"], reason: "数据主题属于宏观经济" },
    { codes: ["population-society"], keywords: ["人口", "社会", "就业", "教育", "年龄", "劳动力"], reason: "数据主题属于人口与社会" },
    { codes: ["financial-markets"], keywords: ["金融", "股票", "基金", "债券", "市场", "证券"], reason: "数据主题属于金融与市场" },
    { codes: ["industry-enterprise"], keywords: ["行业", "企业", "公司", "产业", "制造"], reason: "数据主题属于行业与企业" },
    { codes: ["ecommerce-consumption"], keywords: ["电商", "消费", "零售", "商品", "订单"], reason: "数据主题属于电商与消费" },
    { codes: ["technology-ai"], keywords: ["科技", "人工智能", "ai", "软件", "互联网"], reason: "数据主题属于科技与 AI" },
    { codes: ["real-estate-geography"], keywords: ["房地产", "地产", "房价", "地理", "城市"], reason: "数据主题属于房地产与地理" },
    { codes: ["automotive-mobility"], keywords: ["汽车", "新能源车", "出行", "销量"], reason: "数据主题属于汽车与出行" },
    { codes: ["sports-entertainment"], keywords: ["体育", "足球", "篮球", "nba", "娱乐"], reason: "数据主题属于体育与娱乐" },
    { codes: ["energy-environment"], keywords: ["能源", "电力", "环保", "碳排放", "环境"], reason: "数据主题属于能源与环境" },
    { codes: ["public-services"], keywords: ["公共", "政府", "医疗", "卫生", "交通", "服务"], reason: "数据主题属于公共服务" },
  ],
};

function compactText(input: RecommendationInput) {
  const definition = input.definition;
  const widgetText = definition?.widgets?.flatMap((widget) => [widget.title, widget.dimension, widget.metric]) || [];
  const filterText = definition?.filters?.map((filter) => filter.label) || [];
  return [input.title, input.summary, input.reportName, definition?.title, definition?.subTitle, definition?.dateRange, ...filterText, ...widgetText]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ")
    .toLowerCase();
}

function categoryForCode(categories: ResourceCategoryOption[], codes: string[]) {
  for (const code of codes) {
    const exact = categories.find((category) => category.code === code);
    if (exact) return exact;
  }
  return null;
}

function makeRecommendation(category: ResourceCategoryOption, reason: string, confidence: number, source: "ai" | "rules"): ResourceCategoryRecommendation {
  return {
    categoryId: category.id,
    categoryCode: category.code,
    categoryName: category.name,
    pathLabel: category.pathLabel,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason,
    source,
  };
}

function ruleRecommendations(input: RecommendationInput) {
  const text = compactText(input);
  const matches = RECOMMENDATION_RULES[input.assetType]
    .map((rule) => ({ rule, score: rule.keywords.reduce((score, keyword) => score + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  const recommendations: ResourceCategoryRecommendation[] = [];
  for (const { rule, score } of matches) {
    const category = categoryForCode(input.categories, rule.codes);
    if (!category || recommendations.some((item) => item.categoryId === category.id)) continue;
    recommendations.push(makeRecommendation(category, rule.reason, Math.min(0.94, 0.56 + score * 0.1), "rules"));
    if (recommendations.length === 3) break;
  }
  return recommendations;
}

function parseAiRecommendations(content: string, categories: ResourceCategoryOption[]) {
  const jsonText = content.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { recommendations?: unknown }).recommendations)) return [];
  const byCode = new Map(categories.map((category) => [category.code, category]));
  const result: ResourceCategoryRecommendation[] = [];
  for (const item of (parsed as { recommendations: unknown[] }).recommendations) {
    if (!item || typeof item !== "object") continue;
    const value = item as { categoryCode?: unknown; confidence?: unknown; reason?: unknown };
    const category = typeof value.categoryCode === "string" ? byCode.get(value.categoryCode) : undefined;
    if (!category || result.some((candidate) => candidate.categoryId === category.id)) continue;
    const confidence = typeof value.confidence === "number" ? value.confidence : 0.65;
    const reason = typeof value.reason === "string" && value.reason.trim() ? value.reason.trim().slice(0, 160) : "根据报告内容推荐该分类";
    result.push(makeRecommendation(category, reason, confidence, "ai"));
    if (result.length === 3) break;
  }
  return result;
}

async function aiRecommendations(input: RecommendationInput) {
  const availableCategories = input.categories.map((category) => ({ code: category.code, path: category.pathLabel, level: category.level }));
  const response = await requestConfiguredAgentCompletion({
    system: "你是 DataTalk 资源中心的分类助手。只能从用户提供的分类 code 中选择，不能创造、改写或组合分类。只输出 JSON，不要 Markdown。",
    user: JSON.stringify({
      task: "为资源选择最多 3 个候选分类，按相关性降序排列",
      output: { recommendations: [{ categoryCode: "已有分类 code", confidence: 0.0, reason: "不超过 80 字的中文原因" }] },
      assetType: input.assetType,
      title: input.title,
      summary: input.summary || "",
      reportName: input.reportName || "",
      contentSignals: compactText(input),
      availableCategories,
    }),
    maxTokens: 600,
    timeoutMs: 10000,
  });
  return response ? parseAiRecommendations(response, input.categories) : [];
}

export async function recommendResourceCategories(input: RecommendationInput) {
  if (!input.categories.length) return [];
  try {
    const recommendations = await aiRecommendations(input);
    if (recommendations.length) return recommendations;
  } catch {
    // Model availability must not block publishing. Rules remain the default path.
  }
  return ruleRecommendations(input);
}
