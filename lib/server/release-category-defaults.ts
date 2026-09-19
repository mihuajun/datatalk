export type ReleaseCategoryDefault = {
  code: string;
  name: string;
  description: string;
  sortOrder: number;
};

export const RELEASE_CATEGORY_DEFAULTS: ReleaseCategoryDefault[] = [
  { code: "uncategorized", name: "未分类", description: "默认兜底分类，适用于暂未归档的发布报表", sortOrder: 0 },
  { code: "overview", name: "经营总览", description: "管理驾驶舱、核心经营指标与整体趋势总览", sortOrder: 10 },
  { code: "sales", name: "销售分析", description: "销售额、订单、客户与渠道转化分析", sortOrder: 20 },
  { code: "operations", name: "运营监控", description: "活动、投放、流量与日常运营过程监控", sortOrder: 30 },
  { code: "user-growth", name: "用户增长", description: "新增、活跃、留存、转化与用户生命周期分析", sortOrder: 40 },
  { code: "product", name: "商品分析", description: "商品表现、品类结构与爆品经营分析", sortOrder: 50 },
  { code: "supply-chain", name: "供应链库存", description: "库存、采购、履约与供应链效率分析", sortOrder: 60 },
  { code: "finance", name: "财务专题", description: "收入、成本、利润、现金流与回款专题分析", sortOrder: 70 },
  { code: "stores", name: "区域门店", description: "区域、门店、城市与直营网点经营分析", sortOrder: 80 },
  { code: "organization", name: "人效组织", description: "团队目标、组织效能与人效经营分析", sortOrder: 90 },
  { code: "service-risk", name: "服务与风控", description: "客服质量、异常预警、售后与风险监控分析", sortOrder: 100 },
];
