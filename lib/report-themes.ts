export type ReportThemeId = "default" | "dark-business" | "fresh-minimal" | "tech-blue" | "custom";

export type ReportTheme = {
  id: ReportThemeId;
  name: string;
  description: string;
  /** 写入 AI prompt 的设计风格指引 */
  prompt: string;
  /** 预览卡片使用的色板 */
  swatches: { background: string; primary: string; accent: string };
};

export const REPORT_THEMES: ReportTheme[] = [
  {
    id: "default",
    name: "默认风格",
    description: "简洁现代，白底蓝主色，通用商务报表",
    prompt: [
      "整体风格：简洁现代的通用商务报表风格。",
      "配色：页面背景 #F5F8FD，卡片背景 #FFFFFF，主色 #2167E8，辅助文字 #526174，标题 #17243A，边框 #E7EDF5。",
      "字体：系统默认无衬线字体栈，标题加粗，层级通过字号与字重区分。",
      "圆角与阴影：卡片圆角 8-10px，使用轻微投影；留白适中，信息密度中等。",
    ].join("\n"),
    swatches: { background: "#F5F8FD", primary: "#2167E8", accent: "#17243A" },
  },
  {
    id: "dark-business",
    name: "暗黑商务",
    description: "深色底、高对比，金色点缀的高端商务感",
    prompt: [
      "整体风格：暗黑商务风，深色背景、高对比度、高端稳重。",
      "配色：页面背景 #0B1220 / #111A2E，卡片背景 #16213A，主文字 #E6EBF5，辅助文字 #8A98B8，主色 #F5B951（金色点缀），数据高亮可用 #4ADE80 / #38BDF8。",
      "图表：坐标轴与网格线使用低亮度颜色（rgba(255,255,255,0.08-0.15)），系列色使用高饱和亮色保证在深色底上可读。",
      "细节：卡片边框 1px rgba(255,255,255,0.06)，圆角 10px，避免纯白大面积色块。",
    ].join("\n"),
    swatches: { background: "#0B1220", primary: "#F5B951", accent: "#38BDF8" },
  },
  {
    id: "fresh-minimal",
    name: "清新简约",
    description: "浅色柔和，大量留白，轻盈圆角",
    prompt: [
      "整体风格：清新简约，浅色柔和配色，大量留白，视觉轻盈。",
      "配色：页面背景 #FAFBFC，卡片背景 #FFFFFF，主色 #10B981（清新绿），点缀 #14B8A6，标题 #1F2937，正文 #6B7280，分割线 #F0F2F5。",
      "排版：增大区块间距与内边距，字号层级舒缓，避免密集排布；数字指标使用大字号突出。",
      "圆角与阴影：圆角 12-16px，阴影极轻或无阴影，可用 1px 浅边框代替阴影。",
    ].join("\n"),
    swatches: { background: "#FAFBFC", primary: "#10B981", accent: "#14B8A6" },
  },
  {
    id: "tech-blue",
    name: "科技蓝",
    description: "深蓝渐变、荧光青蓝，数据科技感",
    prompt: [
      "整体风格：科技蓝数据大屏风，深蓝渐变背景，荧光青蓝高亮。",
      "配色：页面背景线性渐变 #0A1A3F → #061224，卡片背景 rgba(16,42,90,0.6) 或 #0E2A5C，主色 #2F7CFF，高亮 #22D3EE，点缀 #7C3AED，主文字 #EAF2FF，辅助文字 #7C93C4。",
      "细节：卡片可使用 1px 半透明蓝色边框（rgba(47,124,255,0.35)）与轻微发光效果（box-shadow 蓝色外发光），圆角 8px。",
      "图表：网格线 rgba(124,147,196,0.15)，系列色以蓝青紫为主，关键指标可加发光或渐变效果。",
    ].join("\n"),
    swatches: { background: "#0A1A3F", primary: "#2F7CFF", accent: "#22D3EE" },
  },
  {
    id: "custom",
    name: "自定义",
    description: "在对话中描述你想要的风格，AI 按需设计",
    prompt: "",
    swatches: { background: "#FFFFFF", primary: "#7C3AED", accent: "#F59E0B" },
  },
];

export function findReportTheme(id: unknown): ReportTheme | null {
  if (typeof id !== "string") return null;
  return REPORT_THEMES.find((theme) => theme.id === id) ?? null;
}

export function normalizeReportThemeId(value: unknown): ReportThemeId {
  const theme = findReportTheme(value);
  return theme ? theme.id : "default";
}

/** 从 report.json 内容中解析主题字段（兼容字符串或对象形式） */
export function parseReportThemeFromDocument(document: unknown): { id: ReportThemeId; custom?: string } {
  if (!document || typeof document !== "object" || Array.isArray(document)) return { id: "default" };
  const raw = (document as { theme?: unknown }).theme;
  if (typeof raw === "string") return { id: normalizeReportThemeId(raw) };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const candidate = raw as { id?: unknown; custom?: unknown };
    return {
      id: normalizeReportThemeId(candidate.id),
      ...(typeof candidate.custom === "string" && candidate.custom.trim() ? { custom: candidate.custom.trim() } : {}),
    };
  }
  return { id: "default" };
}

/** 生成注入 AI prompt 的主题指引文本；自定义风格无描述时返回空串 */
export function buildThemePrompt(theme: { id: ReportThemeId; custom?: string }): string {
  if (theme.id === "custom") {
    return theme.custom
      ? `报表采用自定义风格，设计要求如下：\n${theme.custom}`
      : "";
  }
  const preset = findReportTheme(theme.id);
  if (!preset || preset.id === "default") {
    return preset ? `报表采用「${preset.name}」：\n${preset.prompt}` : "";
  }
  return `报表采用「${preset.name}」：\n${preset.prompt}`;
}
