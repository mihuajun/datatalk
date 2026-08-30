export const REPORT_STATUSES = ["已发布", "草稿"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type ReportWidgetType = "kpi" | "line" | "bar" | "table";

export type ReportWidget = {
  id: string;
  type: ReportWidgetType;
  title: string;
  dimension: string;
  metric: string;
};

export type ReportDefinition = {
  title: string;
  subTitle?: string;
  dateRange: string;
  filters: Array<{ label: string; value: string }>;
  widgets: ReportWidget[];
};

export type ReportPageDocument = {
  schemaVersion: "1.0";
  title: string;
  subTitle: string;
  dateRange: string;
  filters: Array<{
    key: string;
    label: string;
    type: "select";
    defaultValue: string;
    required: boolean;
  }>;
  layout: {
    type: "dashboard";
    columns: number;
  };
  widgets: Array<{
    widgetId: string;
    type: ReportWidgetType;
    title: string;
    bindingRef: string;
    metricVersion: number;
    formatter: "integer" | "currency" | "number";
    dimension: string;
    metric: string;
    layout: { x: number; y: number; w: number; h: number };
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function widgetType(value: unknown): ReportWidgetType {
  return value === "line" || value === "bar" || value === "table" || value === "kpi" ? value : "table";
}

function widgetId(value: unknown, index: number) {
  const candidate = text(value, `widget-${index + 1}`).replace(/[^A-Za-z0-9_-]/g, "-");
  return candidate || `widget-${index + 1}`;
}

export function fromReportPageDocument(value: unknown, fallbackTitle: string): ReportDefinition | null {
  if (!isRecord(value) || !Array.isArray(value.widgets)) return null;

  const widgets = value.widgets
    .filter(isRecord)
    .map((widget, index) => {
      const type = widgetType(widget.type);
      return {
        id: widgetId(widget.widgetId ?? widget.id, index),
        type,
        title: text(widget.title, `组件 ${index + 1}`),
        dimension: type === "kpi" ? "" : text(widget.dimension, type === "line" ? "日期" : "区域"),
        metric: text(widget.metric, "销售额"),
      };
    });

  const filters = Array.isArray(value.filters)
    ? value.filters.filter(isRecord).map((filter) => ({
      label: text(filter.label, "筛选条件"),
      value: text(filter.defaultValue ?? filter.value, "全部"),
    }))
    : [];

  return {
    title: text(value.title, fallbackTitle),
    subTitle: text(value.subTitle, "经营数据概览"),
    dateRange: text(value.dateRange),
    filters,
    widgets,
  };
}

export function toReportPageDocument(definition: ReportDefinition): ReportPageDocument {
  return {
    schemaVersion: "1.0",
    title: text(definition.title, "未命名报表"),
    subTitle: text(definition.subTitle, "经营数据概览"),
    dateRange: text(definition.dateRange),
    filters: definition.filters.map((filter, index) => ({
      key: `filter-${index + 1}`,
      label: text(filter.label, `筛选条件 ${index + 1}`),
      type: "select",
      defaultValue: text(filter.value, "全部"),
      required: false,
    })),
    layout: { type: "dashboard", columns: 2 },
    widgets: definition.widgets.map((widget, index) => {
      const id = widgetId(widget.id, index);
      const type = widgetType(widget.type);
      return {
        widgetId: id,
        type,
        title: text(widget.title, `组件 ${index + 1}`),
        bindingRef: `metric.${id}`,
        metricVersion: 1,
        formatter: type === "kpi" ? (widget.metric === "订单数" ? "integer" : "currency") : "number",
        dimension: type === "kpi" ? "" : text(widget.dimension, type === "line" ? "日期" : "区域"),
        metric: text(widget.metric, "销售额"),
        layout: { x: index % 2, y: Math.floor(index / 2), w: type === "table" ? 2 : 1, h: 1 },
      };
    }),
  };
}

export function toReportDocument(input: { tenantId: number; reportCode: string; name: string; updatedAt?: string }) {
  return {
    schemaVersion: "1.0" as const,
    reportCode: input.reportCode,
    tenantId: String(input.tenantId),
    name: text(input.name, input.reportCode),
    entry: "page.html" as const,
    format: "web" as const,
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

export type ReportItem = {
  id: string;
  code: string;
  name: string;
  owner: string;
  ownerId: string | null;
  updatedAt: string;
  views: number;
  status: ReportStatus;
  publicLinkEnabled: boolean;
};

export type ReportFolder = {
  id: string;
  parentId: string | null;
  name: string;
  isDefault: boolean;
  reportCount: number;
  children: ReportFolder[];
  reports: ReportItem[];
};

export type ReportCenterSummary = {
  folderCount: number;
  reportCount: number;
  publishedCount: number;
  draftCount: number;
};

export type ReportCenterData = {
  folders: ReportFolder[];
  summary: ReportCenterSummary;
};
