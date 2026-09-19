import type { ResourceAssetType } from "@/lib/resource-center-types";

export type ResourceCategoryDefault = {
  assetType: ResourceAssetType;
  code: string;
  name: string;
  parentCode?: string;
  sortOrder: number;
};

type CategorySeed = [string, string, Array<[string, string]>?];

function buildCategoryDefaults(assetType: ResourceAssetType, roots: CategorySeed[]) {
  const defaults: ResourceCategoryDefault[] = [];
  roots.forEach(([code, name, children], rootIndex) => {
    const rootSortOrder = (rootIndex + 1) * 10;
    defaults.push({ assetType, code, name, sortOrder: rootSortOrder });
    (children || []).forEach(([childCode, childName], childIndex) => {
      defaults.push({ assetType, code: childCode, name: childName, parentCode: code, sortOrder: rootSortOrder + childIndex + 1 });
    });
  });
  return defaults;
}

const REPORT_CATEGORY_DEFAULTS = buildCategoryDefaults("report", [
  ["enterprise-operations", "企业经营", [["management-dashboard", "管理驾驶舱"], ["business-target", "经营目标"], ["business-performance", "综合绩效"], ["regional-operations", "区域经营"]]],
  ["sales-analysis", "销售分析", [["sales-achievement", "销售达成"], ["customer-analysis", "客户分析"], ["channel-analysis", "渠道分析"], ["regional-sales", "区域销售"], ["sales-funnel", "销售漏斗"]]],
  ["finance-analysis", "财务分析", [["revenue-analysis", "收入分析"], ["cost-profit", "成本利润"], ["cash-flow", "现金流"], ["budget-execution", "预算执行"]]],
  ["users-customers", "用户与客户", [["user-profile", "用户画像"], ["customer-value", "客户价值"], ["retention-analysis", "活跃留存"], ["customer-service", "客户服务"]]],
  ["ecommerce-products", "电商与商品", [["ecommerce-overview", "电商经营"], ["product-analysis", "商品分析"], ["inventory-analysis", "库存分析"], ["store-operation", "门店经营"]]],
  ["marketing-growth", "市场与增长", [["marketing-campaign", "营销活动"], ["channel-growth", "渠道增长"], ["conversion-analysis", "转化分析"], ["brand-analysis", "品牌分析"]]],
  ["people-hr", "人员与 HR", [["headcount", "人员规模"], ["recruitment", "招聘分析"], ["attrition", "人员流失"], ["organization-effectiveness", "组织效能"], ["labor-cost", "人力成本"]]],
  ["supply-operations", "供应链与运营", [["procurement", "采购分析"], ["fulfillment", "履约分析"], ["warehouse", "仓储分析"], ["quality-management", "质量管理"]]],
  ["industry-public", "行业与公共数据", [["macro-economy", "宏观经济"], ["population-society", "人口与社会"], ["industry-research", "行业研究"], ["public-data", "公共数据"]]],
]);

const TEMPLATE_CATEGORY_DEFAULTS = buildCategoryDefaults("template", [
  ["enterprise-operations", "企业经营", [["management-dashboard", "管理驾驶舱"], ["business-target", "经营目标"], ["business-performance", "综合绩效"], ["regional-operations", "区域经营"]]],
  ["sales-analysis", "销售分析", [["sales-achievement", "销售达成"], ["customer-analysis", "客户分析"], ["channel-analysis", "渠道分析"], ["sales-funnel", "销售漏斗"]]],
  ["finance-analysis", "财务分析", [["revenue-analysis", "收入分析"], ["cost-profit", "成本利润"], ["cash-flow", "现金流"], ["budget-execution", "预算执行"]]],
  ["user-analysis", "用户分析", [["user-growth", "用户增长"], ["active-retention", "活跃留存"], ["user-segmentation", "用户分层"], ["user-value", "用户价值"]]],
  ["ecommerce-analysis", "电商分析", [["ecommerce-overview", "电商经营"], ["product-analysis", "商品分析"], ["inventory-analysis", "库存分析"], ["store-operation", "门店经营"]]],
  ["marketing-analysis", "市场分析", [["marketing-campaign", "营销活动"], ["channel-growth", "渠道增长"], ["conversion-analysis", "转化分析"], ["brand-analysis", "品牌分析"]]],
  ["hr-analysis", "HR 分析", [["headcount", "人员规模"], ["recruitment", "招聘分析"], ["attrition", "人员流失"], ["organization-structure", "组织结构"], ["labor-cost", "人力成本"]]],
  ["supply-chain-analysis", "供应链分析", [["procurement", "采购分析"], ["fulfillment", "履约分析"], ["warehouse", "仓储分析"], ["quality-management", "质量管理"]]],
  ["product-project", "产品与项目", [["product-performance", "产品表现"], ["project-progress", "项目进度"], ["feature-usage", "功能使用"]]],
  ["service-operations", "服务与运营", [["customer-service", "客户服务"], ["service-quality", "服务质量"], ["operation-monitoring", "运营监控"]]],
]);

const DATASET_CATEGORY_DEFAULTS = buildCategoryDefaults("dataset", [
  ["macro-economy", "宏观经济"],
  ["population-society", "人口与社会"],
  ["financial-markets", "金融与市场"],
  ["industry-enterprise", "行业与企业"],
  ["ecommerce-consumption", "电商与消费"],
  ["technology-ai", "科技与 AI"],
  ["real-estate-geography", "房地产与地理"],
  ["automotive-mobility", "汽车与出行"],
  ["sports-entertainment", "体育与娱乐"],
  ["energy-environment", "能源与环境"],
  ["public-services", "公共服务"],
]);

export const RESOURCE_CATEGORY_DEFAULTS: ResourceCategoryDefault[] = [
  ...REPORT_CATEGORY_DEFAULTS,
  ...TEMPLATE_CATEGORY_DEFAULTS,
  ...DATASET_CATEGORY_DEFAULTS,
];
