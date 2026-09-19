import { defineTool } from "../../deepseek-harness/node_modules/@deepseek-ai/dsh-tools/lib/index.js";

export const name = "report-tools";
export const inject = ["tools", "attachments"];

function resolveBaseUrl() {
  const value = (process.env.REPORT_AGENT_TOOLS_BASE_URL || "").trim().replace(/\/+$/, "");
  if (value) return value;
  const port = (process.env.PORT || "3000").trim();
  return `http://127.0.0.1:${port}`;
}

function jsonText(value) {
  return [{ type: "text", text: JSON.stringify(value) }];
}

function previewInspectionContent(value) {
  const { screenshot, ...metadata } = value && typeof value === "object" ? value : { value };
  const content = [{ type: "text", text: JSON.stringify(metadata) }];
  if (screenshot && typeof screenshot === "object" && screenshot.attachmentId) {
    content.push({ type: "image", attachment: screenshot });
  }
  return content;
}

async function attachPreviewScreenshot(value, ctx) {
  if (!value || typeof value !== "object" || typeof value.screenshotDataUrl !== "string") return value;
  const { screenshotDataUrl, ...metadata } = value;
  const match = screenshotDataUrl.match(/^data:(image\/png);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return { ...metadata, screenshotAvailable: true, screenshotError: "REPORT_CAPTURE_INVALID" };

  try {
    const attachments = ctx.get("attachments");
    if (!attachments || typeof attachments.saveImage !== "function") {
      return { ...metadata, screenshotAvailable: true, screenshotError: "REPORT_CAPTURE_ATTACHMENT_UNAVAILABLE" };
    }
    const stored = await attachments.saveImage({
      data: Uint8Array.from(Buffer.from(match[2], "base64")),
      mediaType: "image/png",
      name: "report-preview.png",
    });
    return { ...metadata, screenshotAvailable: true, screenshot: stored };
  } catch (error) {
    return { ...metadata, screenshotAvailable: true, screenshotError: error instanceof Error ? error.message : "REPORT_CAPTURE_ATTACHMENT_FAILED" };
  }
}

async function callTool(tool, args, exec) {
  const dshSessionId = exec.agent?.id;
  if (!dshSessionId) {
    throw new Error("REPORT_AGENT_TOOL_SESSION_NOT_FOUND");
  }

  const response = await fetch(`${resolveBaseUrl()}/api/report-agent-tools`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-report-agent-dsh-session-id": dshSessionId,
    },
    body: JSON.stringify({ tool, args }),
    signal: exec.signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.message === "string" ? payload.message : `HTTP_${response.status}`);
  }

  return payload.result;
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "inspect_report_preview",
    description: "检查当前报表会话中可见的编辑器预览。ok:true 和截图成功仅代表取证成功，不代表视觉合格。使用 layoutEvidence 的设计像素坐标、计算样式、同组间距及采样覆盖率，结合截图核对信息层级、字号、留白、对齐、可读性和裁切；旧 elements[].rect 只用于截图聚焦。possibleClipping 和异常间距只是疑点，核实意图和局部截图后才能定性，不能对所有报表使用固定字号/间距阈值。创建整份报告或跨多个区块修改时检查 full 截图，疑点用 elements 中的 selector 取 element 截图；确认问题后修复并在最新 working 版本下重截。预览超时可等待重试，最终证据不足时标为未验证，不能只截图就结束。",
    parameters: {
      includeScreenshot: { type: "boolean", description: "是否返回当前可见预览的截图，默认 false；需要比较整体视觉、间距或图表外观时设为 true。" },
      screenshotMode: { type: "string", enum: ["thumbnail", "full", "element"], description: "截图模式：thumbnail 返回首屏缩略图；full 返回完整报表；element 仅返回 screenshotSelector 指定的元素。" },
      screenshotSelector: { type: "string", description: "element 模式必填。优先使用上一次检查结果 elements 中返回的 selector，也可以使用报表源码中的稳定 CSS 选择器。" },
    },
    async execute(args, exec) {
      let result;
      try {
        result = await callTool("inspect_report_preview", args, exec);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "REPORT_PREVIEW_INSPECTION_TIMEOUT") throw error;
        result = { ok: false, error: error.message, checkedAt: new Date().toISOString() };
      }
      const evidence = await attachPreviewScreenshot(result, ctx);
      const retryable = evidence.error === "REPORT_PREVIEW_INSPECTION_TIMEOUT" || evidence.screenshotError === "REPORT_PREVIEW_INSPECTION_TIMEOUT";
      return { ...evidence, ...(retryable ? { retryable: true } : {}), visualAssessment: "not_assessed", visualReviewRequired: args.includeScreenshot === true };
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => previewInspectionContent(value),
    },
  }));

  ctx.tools.register(defineTool({
    name: "list_data_sources",
    description: "列出当前报表会话所在租户可用的数据源。",
    parameters: {},
    output: {
      schema: { type: "json" },
      render: (_args, value) => jsonText(value),
    },
    async execute(_args, exec) {
      return callTool("list_data_sources", {}, exec);
    },
  }));

  ctx.tools.register(defineTool({
    name: "list_reference_reports",
    description: "列出当前会话用户所在租户可读取的报表，供参考报表任务选择目标；不返回其他租户报表。",
    parameters: {
      keyword: { type: "string", description: "可选报表名称或编码关键词。" },
      limit: { type: "integer", description: "最多返回多少张报表，默认 20，最多 50。" },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => jsonText(value),
    },
    async execute(args, exec) {
      return callTool("list_reference_reports", args, exec);
    },
  }));

  ctx.tools.register(defineTool({
    name: "read_reference_report",
    description: "只读当前会话用户所在租户内指定参考报表的源文件；不能读取其他租户、runtime 或工作区外文件，也不能修改参考报表。",
    parameters: {
      reportCode: { type: "string", required: true, description: "参考报表编码。" },
      files: {
        type: "array",
        description: "可选文件列表，默认读取 report.json、description.md、page.html、styles.css、app.js、server.js。",
        items: { type: "string" },
      },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => jsonText(value),
    },
    async execute(args, exec) {
      return callTool("read_reference_report", args, exec);
    },
  }));

  ctx.tools.register(defineTool({
    name: "get_data_source_schema",
    description: "查看指定数据源下的表和字段结构；REST API 数据源会请求默认资源路径并推断响应字段。",
    parameters: {
      dataSource: { type: "string", required: true, description: "数据源名称。" },
      keyword: { type: "string", description: "可选关键词，用于筛选表名或注释。" },
      tables: {
        type: "array",
        description: "可选表名列表；只查询指定表。",
        items: { type: "string" },
      },
      limit: { type: "integer", description: "最多返回多少张表。" },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => jsonText(value),
    },
    async execute(args, exec) {
      return callTool("get_data_source_schema", args, exec);
    },
  }));

  ctx.tools.register(defineTool({
    name: "preview_sql",
    description: "验证数据库只读 SQL 或 REST API 只读请求是否可执行，并返回列信息与样例结果。",
    parameters: {
      dataSource: { type: "string", required: true, description: "数据源名称。" },
      sql: { type: "string", required: true, description: "数据库填写只读 SQL；REST API 填 GET 请求 JSON，例如 {\"method\":\"GET\",\"path\":\"/api/orders\",\"query\":{\"status\":\":status\"},\"dataPath\":\"data\"}。" },
      params: { type: "json", description: "可选命名参数对象。" },
      maxRows: { type: "integer", description: "最多返回多少行样例数据。" },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => jsonText(value),
    },
    async execute(args, exec) {
      return callTool("preview_sql", args, exec);
    },
  }));

  ctx.tools.register(defineTool({
    name: "list_metric_knowledge",
    description: "列出当前租户已确认、可复用的指标口径；可按关键词筛选。",
    parameters: {
      keyword: { type: "string", description: "可选关键词，用于匹配指标名称、别名或定义文本。" },
      limit: { type: "integer", description: "最多返回多少个指标，默认 20，最多 100。" },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => jsonText(value),
    },
    async execute(args, exec) {
      return callTool("list_metric_knowledge", args, exec);
    },
  }));

  ctx.tools.register(defineTool({
    name: "search_metric_knowledge",
    description: "按指标名称或别名检索当前租户已确认的指标口径，并判断应复用、确认还是新建。",
    parameters: {
      query: { type: "string", required: true, description: "用户使用的指标名称，例如 GMV、成交总额、转化率。" },
      formulaHint: { type: "string", description: "用户明确提到的公式、分子或分母。" },
      timeFieldHint: { type: "string", description: "用户明确提到的时间字段或时间语义。" },
      filters: { type: "array", items: { type: "string" }, description: "用户明确提出的过滤条件。" },
      dedupRule: { type: "string", description: "用户明确提出的去重规则。" },
      dataSource: { type: "string", description: "用户明确指定的数据源。" },
      limit: { type: "integer", description: "最多返回多少个候选，默认 10。" },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => jsonText(value),
    },
    async execute(args, exec) {
      return callTool("search_metric_knowledge", args, exec);
    },
  }));

  ctx.tools.register(defineTool({
    name: "propose_metric_knowledge",
    description: "提交本轮报表实际使用的结构化指标口径候选；服务端只会在 SQL 预览和报表提交成功后发布。",
    parameters: {
      metricKey: { type: "string", description: "复用或更新时使用检索结果中的稳定指标 key；新指标可省略。" },
      name: { type: "string", required: true, description: "指标主名称。" },
      aliases: { type: "array", items: { type: "string" }, description: "用户已确认的别名。" },
      definition: { type: "string", required: true, description: "清晰、可复核的业务定义。" },
      formula: { type: "string", required: true, description: "指标公式，包含聚合方式、字段或分子分母。" },
      grain: { type: "string", description: "基础统计粒度，例如 order、user、day。" },
      timeField: { type: "string", description: "时间字段或时间口径。" },
      filters: { type: "array", items: { type: "string" }, description: "影响口径的过滤条件。" },
      dedupRule: { type: "string", description: "去重字段和规则。" },
      dataSource: { type: "string", description: "实现使用的数据源名称。" },
      sourceRef: { type: "string", required: true, description: "当前报表实现位置，例如 server.js#handler:sales-summary。" },
      confirmed: { type: "boolean", required: true, description: "用户是否已明确给出口径、选择候选或确认更新。" },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => jsonText(value),
    },
    async execute(args, exec) {
      return callTool("propose_metric_knowledge", args, exec);
    },
  }));

  ctx.tools.register(defineTool({
    name: "record_metric_feedback",
    description: "记录用户对历史指标口径的接受、拒绝或纠正。",
    parameters: {
      metricKey: { type: "string", required: true, description: "检索结果中的指标 key。" },
      action: { type: "string", required: true, description: "accepted、rejected 或 corrected。" },
      reason: { type: "string", description: "用户反馈原因。" },
      before: { type: "json", description: "纠正前的关键口径。" },
      after: { type: "json", description: "纠正后的关键口径。" },
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => jsonText(value),
    },
    async execute(args, exec) {
      return callTool("record_metric_feedback", args, exec);
    },
  }));
}
