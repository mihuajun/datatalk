"use client";

import { ArrowUpRight, Building2, CalendarDays, Check, Eye, FileBarChart2, FolderTree, Heart, LoaderCircle, RefreshCw, Sparkles, UploadCloud } from "lucide-react";

import { RESOURCE_ASSET_TYPE_LABELS, type ResourceAssetType, type ResourceCategoryOption, type ResourceCategoryRecommendation } from "@/lib/resource-center-types";

type ResourcePublishFormValue = {
  title: string;
  summary: string;
  thumbnailUrl: string;
  categoryId: string;
  assetType: ResourceAssetType;
};

type ResourcePublishPanelProps = {
  visible: boolean;
  saving: boolean;
  buttonLabel: string;
  submitLabel: string;
  form: ResourcePublishFormValue;
  previewThumbnailUrl?: string;
  thumbnailLoading: boolean;
  categoriesByType: Partial<Record<ResourceAssetType, ResourceCategoryOption[]>>;
  recommendation: ResourceCategoryRecommendation | null;
  recommendationLoading: boolean;
  error?: string;
  onToggle: () => void;
  onChange: (key: keyof ResourcePublishFormValue, value: string) => void;
  onRecommend: () => void;
  onSubmit: () => void;
};

export function ResourcePublishPanel({
  visible,
  saving,
  buttonLabel,
  submitLabel,
  form,
  previewThumbnailUrl,
  thumbnailLoading,
  categoriesByType,
  recommendation,
  recommendationLoading,
  error,
  onToggle,
  onChange,
  onRecommend,
  onSubmit,
}: ResourcePublishPanelProps) {
  const categories = categoriesByType[form.assetType] || [];
  const industries = categories.filter((category) => category.level === 0);
  const selectedCategory = categories.find((category) => String(category.id) === form.categoryId);
  const selectedIndustryId = selectedCategory?.level === 0 ? selectedCategory.id : selectedCategory?.parentId || "";
  const subcategories = categories.filter((category) => category.parentId === Number(selectedIndustryId));
  const selectedIndustry = industries.find((category) => category.id === Number(selectedIndustryId));
  const selectedSubcategory = selectedCategory?.level === 1 ? selectedCategory : undefined;
  const categoryLabel = selectedIndustry
    ? selectedSubcategory
      ? `${selectedIndustry.name} / ${selectedSubcategory.name}`
      : selectedIndustry.name
    : "未选择分类";
  const effectivePreviewUrl = previewThumbnailUrl || "";
  const recommendationSelected = recommendation?.categoryId === Number(form.categoryId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition ${
          visible
            ? "border-[#A7C4F7] bg-[#EDF3FF] text-[#2167E8]"
            : "border-[#DDE5F0] bg-white text-[#526174] hover:border-[#2167E8] hover:text-[#2167E8]"
        }`}
        aria-expanded={visible}
        title={buttonLabel}
      >
        <UploadCloud className="h-3.5 w-3.5" />
        {buttonLabel}
      </button>
      {visible ? (
        <div className="absolute right-0 top-[42px] z-30 flex max-h-[calc(100dvh-96px)] w-[min(760px,calc(100vw-32px))] flex-col rounded-lg border border-[#DDE5F0] bg-white shadow-[0_18px_40px_rgba(23,36,58,0.14)]">
          <div className="shrink-0 border-b border-[#E7EDF5] px-4 py-3 text-sm font-bold text-[#17243A]">{buttonLabel}</div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-3">
            <label className="block">
              <span className="text-[11px] font-semibold text-[#526174]">发布类型</span>
              <select
                value={form.assetType}
                onChange={(event) => onChange("assetType", event.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-[#DDE5F0] bg-white px-3 text-[13px] text-[#17243A] outline-none transition focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10"
              >
                {(Object.entries(RESOURCE_ASSET_TYPE_LABELS) as Array<[ResourceAssetType, string]>).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <div className="block">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#526174]">
                  <FolderTree className="h-3.5 w-3.5 text-[#98A2B3]" />
                  所属分类
                </span>
                <button
                  type="button"
                  onClick={onRecommend}
                  disabled={recommendationLoading || !categories.length}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#2167E8] transition hover:bg-[#EDF3FF] disabled:cursor-not-allowed disabled:opacity-50"
                  title="刷新分类推荐"
                  aria-label="刷新分类推荐"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${recommendationLoading ? "animate-spin" : ""}`} />
                </button>
                {recommendation && !recommendationLoading ? (
                  <button
                    type="button"
                    onClick={() => onChange("categoryId", String(recommendation.categoryId))}
                    disabled={recommendationSelected}
                    className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md bg-[#EDF3FF] px-1.5 text-[11px] font-semibold text-[#2167E8] transition hover:bg-[#DCE9FF] disabled:cursor-default disabled:bg-[#EAF8F2] disabled:text-[#16845B]"
                    title={`${recommendation.pathLabel} · ${Math.round(recommendation.confidence * 100)}% 匹配 · ${recommendation.reason}`}
                    aria-label={recommendationSelected ? `已采用推荐分类：${recommendation.pathLabel}` : `采用推荐分类：${recommendation.pathLabel}`}
                  >
                    {recommendationSelected ? <Check className="h-3 w-3 shrink-0" /> : <Sparkles className="h-3 w-3 shrink-0" />}
                    <span className="min-w-0 truncate">{recommendation.pathLabel}</span>
                    <span className="shrink-0 text-[10px] opacity-70">{Math.round(recommendation.confidence * 100)}%</span>
                  </button>
                ) : null}
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <select
                  value={selectedIndustryId ? String(selectedIndustryId) : ""}
                  onChange={(event) => onChange("categoryId", event.target.value)}
                  aria-label="一级分类"
                  title={selectedIndustry?.name || "一级分类"}
                  className="h-10 min-w-0 w-full truncate rounded-md border border-[#DDE5F0] bg-white px-2 text-[13px] text-[#17243A] outline-none transition focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10"
                >
                  <option value="">一级分类</option>
                  {industries.map((category) => (
                    <option key={category.id} value={String(category.id)}>{category.name}</option>
                  ))}
                </select>
                <select
                  value={selectedCategory?.level === 1 ? form.categoryId : ""}
                  onChange={(event) => onChange("categoryId", event.target.value || String(selectedIndustryId))}
                  disabled={!selectedIndustryId || subcategories.length === 0}
                  aria-label="二级分类"
                  title={selectedSubcategory?.name || "二级分类"}
                  className="h-10 min-w-0 w-full truncate rounded-md border border-[#DDE5F0] bg-white px-2 text-[13px] text-[#17243A] outline-none transition focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10 disabled:cursor-not-allowed disabled:bg-[#F7F9FC] disabled:text-[#98A2B3]"
                >
                  <option value="">二级分类</option>
                  {subcategories.map((category) => (
                    <option key={category.id} value={String(category.id)}>{category.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <label className="block">
              <span className="text-[11px] font-semibold text-[#526174]">资源标题</span>
              <input
                value={form.title}
                onChange={(event) => onChange("title", event.target.value)}
                maxLength={160}
                className="mt-1.5 h-10 w-full rounded-md border border-[#DDE5F0] px-3 text-[13px] text-[#17243A] outline-none transition focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10"
                placeholder="例如：区域销售驾驶舱"
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-semibold text-[#526174]">资源摘要</span>
              <textarea
                value={form.summary}
                onChange={(event) => onChange("summary", event.target.value)}
                maxLength={500}
                rows={1}
                className="mt-1.5 min-h-[40px] w-full resize-y rounded-md border border-[#DDE5F0] px-3 py-2.5 text-[13px] text-[#17243A] outline-none transition focus:border-[#2167E8] focus:ring-4 focus:ring-[#2167E8]/10"
                placeholder="一句话说明这个资源适合解决什么问题"
              />
            </label>
              </div>
              <div className="min-w-0 space-y-3">
            <div className="block">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-[#526174]">资源中心预览</span>
                {thumbnailLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#2167E8]" aria-label="正在生成缩略图" /> : null}
              </div>
              <div className="mt-2 overflow-hidden rounded-md border border-[#E7EDF5] bg-white shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
                <div className="relative flex aspect-[1200/630] items-center justify-center overflow-hidden border-b border-[#EDF1F6] bg-[#F6F8FB]">
                  {effectivePreviewUrl ? <img src={effectivePreviewUrl} alt="资源中心卡片缩略图预览" className="block h-full w-full object-contain" /> : <FileBarChart2 className="text-[#64748B]" size={20} />}
                  <span className="absolute left-3 top-3 max-w-[calc(100%-24px)] truncate rounded-full bg-[rgba(20,32,51,0.66)] px-2 py-1 text-[10px] font-semibold text-white">{categoryLabel}</span>
                </div>
                <div className="grid gap-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <strong className="line-clamp-2 text-[14px] font-semibold leading-5 tracking-[-0.01em] text-[#142033]">{form.title || "资源标题"}</strong>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-[#19815C]"><span className="h-1.5 w-1.5 rounded-full bg-current" />已发布</span>
                  </div>
                  {form.summary ? <p className="line-clamp-2 text-[11px] leading-[1.72] text-[#7C8897]">{form.summary}</p> : <p className="text-[11px] leading-[1.72] text-[#A2ACB9]">资源摘要将在这里展示</p>}
                  <div className="flex items-center gap-3 pt-1 text-[10px] text-[#8C97A6]"><span className="inline-flex min-w-0 items-center gap-1.5 truncate"><Building2 size={13} />DataTalk</span><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><CalendarDays size={13} />最近发布</span></div>
                  <div className="flex items-center justify-between gap-2 border-t border-[#EDF1F6] pt-2 text-[10px] text-[#94A0AD]"><span className="inline-flex items-center gap-3"><span className="inline-flex items-center gap-1"><Eye size={13} />0</span><span className="inline-flex items-center gap-1"><Heart size={13} />0</span></span><span className="inline-flex items-center gap-1.5 font-semibold text-[#22314C]">新窗口打开 <ArrowUpRight size={15} /></span></div>
                </div>
              </div>
            </div>
              </div>
            </div>

            {error ? <div className="mt-3 rounded-md border border-[#F5D4CC] bg-[#FFF8F6] px-3 py-2 text-[12px] text-[#B42318]">{error}</div> : null}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#E7EDF5] px-4 py-3">
            <button type="button" onClick={onToggle} className="inline-flex h-9 items-center rounded-md border border-[#DDE5F0] px-3 text-xs font-semibold text-[#526174] transition hover:border-[#B8C5D8] hover:bg-[#F7F9FC]">取消</button>
            <button type="button" onClick={onSubmit} disabled={saving} className="inline-flex h-9 items-center rounded-md bg-[#2167E8] px-3 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(33,103,232,0.18)] transition hover:bg-[#1858CC] disabled:cursor-not-allowed disabled:opacity-60">{saving ? "处理中" : submitLabel}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
