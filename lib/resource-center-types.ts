export type ResourceItemStatus = "draft" | "pending_review" | "published" | "offline" | "rejected";

export type ResourceAssetType = "report" | "template" | "dataset";

export const RESOURCE_ASSET_TYPE_LABELS: Record<ResourceAssetType, string> = {
  report: "报告",
  template: "模板",
  dataset: "数据集",
};

export type ResourceCategoryOption = {
  id: number;
  assetType: ResourceAssetType;
  parentId: number | null;
  code: string;
  name: string;
  level: number;
  pathLabel: string;
  isLeaf: boolean;
};

export type ResourceCategoryRecommendation = {
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  pathLabel: string;
  confidence: number;
  reason: string;
  source: "ai" | "rules";
};

export type ResourceItemRecord = {
  id: number;
  tenantId: number;
  assetType: ResourceAssetType;
  sourceCode: string;
  sourceVersion: number;
  status: ResourceItemStatus;
  title: string;
  summary: string | null;
  thumbnailUrl: string | null;
  categoryId: number | null;
  categoryName: string | null;
  viewCount: number;
  favoriteCount: number;
  likeCount: number;
  contentUpdatedAt: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
};
