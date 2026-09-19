import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResourcePublishPanel } from "@/components/reports/resource-publish-panel";
import type { ResourceCategoryRecommendation } from "@/lib/resource-center-types";

const recommendation: ResourceCategoryRecommendation = {
  categoryId: 1,
  categoryCode: "sales-analysis",
  categoryName: "销售分析",
  pathLabel: "销售 / 销售分析",
  confidence: 0.9,
  reason: "资源内容包含销售指标",
  source: "rules",
};

function render(recommended: ResourceCategoryRecommendation | null, loading = false) {
  return renderToStaticMarkup(createElement(ResourcePublishPanel, {
    visible: true,
    saving: false,
    buttonLabel: "发布到资源中心",
    submitLabel: "确认发布",
    form: { title: "", summary: "", thumbnailUrl: "", categoryId: "", assetType: "report" },
    thumbnailLoading: false,
    categoriesByType: { report: [{ id: 1, assetType: "report", parentId: null, code: "sales-analysis", name: "销售分析", level: 0, pathLabel: "销售分析", isLeaf: true }] },
    recommendation: recommended,
    recommendationLoading: loading,
    onToggle: () => {},
    onChange: () => {},
    onRecommend: () => {},
    onSubmit: () => {},
  }));
}

const empty = render(null);
assert.ok(empty.includes("所属分类"));
assert.ok(empty.includes('aria-label="刷新分类推荐"'));
assert.ok(empty.indexOf("所属分类") < empty.indexOf('aria-label="刷新分类推荐"'));
assert.ok(empty.includes('class="mt-1.5 grid grid-cols-2 gap-2"'));
assert.ok(empty.indexOf('aria-label="一级分类"') < empty.indexOf('aria-label="二级分类"'));
assert.ok(empty.includes('rows="1"'));
assert.ok(empty.includes("resize-y"));
assert.ok(!empty.includes("系统推荐"));

const recommended = render(recommendation);
assert.ok(recommended.includes('aria-label="采用推荐分类：销售 / 销售分析"'));
assert.ok(recommended.includes("90%"));
assert.ok(recommended.indexOf("所属分类") < recommended.indexOf('aria-label="采用推荐分类：销售 / 销售分析"'));
assert.ok(!recommended.includes("系统推荐"));
assert.ok(!render(null, true).includes("系统推荐"));
