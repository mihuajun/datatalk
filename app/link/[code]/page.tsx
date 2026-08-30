import { BarChart3, LineChart, Table2 } from "lucide-react";
import { notFound } from "next/navigation";

import { ReportWebFrame } from "@/components/report-web-frame";
import { PublicLinkAccessForm } from "@/app/link/[code]/public-link-access-form";
import { resolveReportFilterValues, toReportSearchParams, type ReportPageSearchParams } from "@/lib/report-filters";
import type { ReportDefinition, ReportWidget, ReportWidgetType } from "@/lib/report-types";
import { composeWebReportSrcDoc } from "@/lib/report-web";
import { getPublicReportDetailByLinkCode } from "@/lib/server/report-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const defaultDefinition: ReportDefinition = {
  title: "销售经营分析",
  dateRange: "最近 30 天",
  filters: [
    { label: "区域", value: "全部区域" },
    { label: "渠道", value: "全部渠道" },
  ],
  widgets: [
    { id: "kpi-sales", type: "kpi", title: "销售额", dimension: "", metric: "销售额" },
    { id: "kpi-orders", type: "kpi", title: "订单数", dimension: "", metric: "订单数" },
    { id: "trend", type: "line", title: "销售额趋势", dimension: "日期", metric: "销售额" },
    { id: "region", type: "bar", title: "区域销售额", dimension: "区域", metric: "销售额" },
    { id: "detail", type: "table", title: "销售明细", dimension: "区域", metric: "销售额" },
  ],
};

const linePoints = "0,92 36,78 72,83 108,50 144,61 180,42 216,48 252,22 288,31 324,12";
const barHeights = [58, 84, 66, 102, 74, 92];

function makeDefinition(definition: ReportDefinition | null, title: string): ReportDefinition {
  if (!definition) return { ...defaultDefinition, title };

  return {
    ...defaultDefinition,
    ...definition,
    title: definition.title || title,
    filters: Array.isArray(definition.filters) ? definition.filters : defaultDefinition.filters,
    widgets: Array.isArray(definition.widgets) && definition.widgets.length ? definition.widgets : defaultDefinition.widgets,
  };
}

function WidgetBadge({ type }: { type: ReportWidgetType }) {
  if (type === "line") return <LineChart className="h-4 w-4" />;
  if (type === "bar") return <BarChart3 className="h-4 w-4" />;
  return <Table2 className="h-4 w-4" />;
}

function WidgetPreview({ widget }: { widget: ReportWidget }) {
  if (widget.type === "kpi") {
    return (
      <div className="flex h-full min-h-[110px] flex-col justify-between rounded-xl border border-[#E3EAF3] bg-white p-5 shadow-[0_8px_20px_rgba(23,36,58,0.04)]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-[#71819B]">{widget.title}</span>
          <span className="rounded-lg bg-[#EDF3FF] p-2 text-[#2167E8]"><BarChart3 className="h-4 w-4" /></span>
        </div>
        <div>
          <div className="text-[28px] font-extrabold tracking-[-0.03em] text-[#17243A]">{widget.metric === "订单数" ? "126,430" : "¥ 8.42M"}</div>
          <div className="mt-1.5 text-xs font-semibold text-[#16845B]">较上期 +12.8%</div>
        </div>
      </div>
    );
  }

  if (widget.type === "line") {
    const gradientId = `public-line-fill-${widget.id}`;
    return (
      <div className="rounded-xl border border-[#E3EAF3] bg-white p-5 shadow-[0_8px_20px_rgba(23,36,58,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#344054]">{widget.title}</h3>
            <p className="mt-1 text-xs text-[#98A2B3]">按{widget.dimension || "日期"}查看{widget.metric || "销售额"}</p>
          </div>
          <span className="rounded-md bg-[#EDF3FF] p-2 text-[#2167E8]"><WidgetBadge type={widget.type} /></span>
        </div>
        <div className="relative mt-6 h-[170px] border-b border-l border-[#E8EEF6] pl-2">
          <div className="absolute inset-x-0 top-1/4 border-t border-dashed border-[#EFF3F8]" />
          <div className="absolute inset-x-0 top-2/4 border-t border-dashed border-[#EFF3F8]" />
          <div className="absolute inset-x-0 top-3/4 border-t border-dashed border-[#EFF3F8]" />
          <svg viewBox="0 0 324 112" preserveAspectRatio="none" className="absolute inset-x-3 bottom-3 h-[112px] w-[calc(100%-24px)] overflow-visible">
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2167E8" stopOpacity=".2" />
                <stop offset="1" stopColor="#2167E8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`M0,112 L${linePoints} L324,112 Z`} fill={`url(#${gradientId})`} />
            <polyline points={linePoints} fill="none" stroke="#2167E8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="absolute inset-x-2 -bottom-5 flex justify-between text-[10px] text-[#98A2B3]">
            <span>6/01</span>
            <span>6/08</span>
            <span>6/15</span>
            <span>6/22</span>
            <span>6/30</span>
          </div>
        </div>
      </div>
    );
  }

  if (widget.type === "bar") {
    return (
      <div className="rounded-xl border border-[#E3EAF3] bg-white p-5 shadow-[0_8px_20px_rgba(23,36,58,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#344054]">{widget.title}</h3>
            <p className="mt-1 text-xs text-[#98A2B3]">按{widget.dimension || "区域"}汇总{widget.metric || "销售额"}</p>
          </div>
          <span className="rounded-md bg-[#EDF3FF] p-2 text-[#2167E8]"><WidgetBadge type={widget.type} /></span>
        </div>
        <div className="mt-7 flex h-[170px] items-end justify-between gap-3 border-b border-[#E8EEF6] px-2">
          {barHeights.map((height, index) => (
            <div key={`${height}-${index}`} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
              <div className={`w-full max-w-[32px] rounded-t-[4px] ${index === 3 ? "bg-[#2167E8]" : "bg-[#9CC0F8]"}`} style={{ height }} />
              <span className="text-[10px] text-[#98A2B3]">{["华东", "华南", "华北", "西南", "华中", "西北"][index]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#E3EAF3] bg-white p-5 shadow-[0_8px_20px_rgba(23,36,58,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#344054]">{widget.title}</h3>
          <p className="mt-1 text-xs text-[#98A2B3]">明细数据</p>
        </div>
        <span className="rounded-md bg-[#EDF3FF] p-2 text-[#2167E8]"><WidgetBadge type={widget.type} /></span>
      </div>
      <div className="mt-5 overflow-hidden rounded-lg border border-[#E8EEF6]">
        <div className="grid grid-cols-3 bg-[#F5F8FF] px-4 py-3 text-[11px] font-semibold text-[#71819B]">
          <span>{widget.dimension || "区域"}</span>
          <span>销售额</span>
          <span>订单数</span>
        </div>
        {["华东", "华南", "华北", "西南"].map((region, index) => (
          <div key={region} className="grid grid-cols-3 border-t border-[#EEF2F7] px-4 py-3 text-xs text-[#526174]">
            <span>{region}</span>
            <span>{["¥2.48M", "¥1.86M", "¥1.55M", "¥1.02M"][index]}</span>
            <span>{["38,420", "26,510", "22,190", "15,320"][index]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function PublicReportPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams?: Promise<ReportPageSearchParams> }) {
  const { code } = await params;
  const publicLinkCode = code.trim();
  if (!publicLinkCode) notFound();

  const result = await getPublicReportDetailByLinkCode(publicLinkCode);
  if (!result) notFound();
  if (result.requiresPassword) return <PublicLinkAccessForm shortCode={publicLinkCode} />;
  const filterResolution = resolveReportFilterValues(result.filterManifest, toReportSearchParams(await searchParams));

  if (result.webFiles["page.html"]) {
    return (
      <main className="min-h-screen bg-[#F4F7FB]">
          <ReportWebFrame
          className="block min-h-screen w-full border-0 bg-[#F4F7FB]"
          title={result.report.name}
            reportCode={publicLinkCode}
            source="release"
            srcDoc={composeWebReportSrcDoc(result.webFiles, { filters: filterResolution.values, urlFilters: filterResolution.urlValues, defaults: filterResolution.defaults })}
            refreshKey={`${publicLinkCode}-${JSON.stringify(filterResolution.values)}`}
        />
      </main>
    );
  }

  const definition = makeDefinition(result.definition, result.report.name);
  const displayFilters = result.filterManifest?.filters.length
    ? result.filterManifest.filters.map((filter) => ({ label: filter.label, value: String(filterResolution.values[filter.key] ?? filter.defaultValue) }))
    : definition.filters;
  const kpiWidgets = definition.widgets.filter((widget) => widget.type === "kpi");
  const contentWidgets = definition.widgets.filter((widget) => widget.type !== "kpi");

  return (
    <main className="min-h-screen bg-[#F4F7FB] p-0 text-[#17243A]">
      <section className="min-h-screen bg-white">
        <div className="border-b border-[#E7EDF5] px-6 pb-6 pt-7 sm:px-8">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-[#2167E8]">
            <BarChart3 className="h-3.5 w-3.5" />
            智能报表
          </div>
          <h1 className="mt-2 text-[26px] font-extrabold tracking-[-0.03em] text-[#17243A]">{definition.title}</h1>
          <p className="mt-2 text-xs text-[#8A98AC]">经营数据概览 · {definition.dateRange}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {displayFilters.map((filter, index) => (
              <span key={`${filter.label}-${index}`} className="inline-flex h-8 items-center gap-2 rounded-md border border-[#DDE5F0] bg-[#FAFCFF] px-3 text-xs text-[#526174]">
                <span className="text-[#8A98AC]">{filter.label}</span>
                <span>{filter.value}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="bg-[#F8FAFD] p-5 sm:p-6">
          {kpiWidgets.length ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {kpiWidgets.map((widget) => <WidgetPreview key={widget.id} widget={widget} />)}
            </div>
          ) : null}

          {contentWidgets.length ? (
            <div className={`grid grid-cols-1 gap-4 lg:grid-cols-2 ${kpiWidgets.length ? "mt-4" : ""}`}>
              {contentWidgets.map((widget, index) => (
                <div key={widget.id} className={widget.type === "table" || index === 0 ? "lg:col-span-2" : ""}>
                  <WidgetPreview widget={widget} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
