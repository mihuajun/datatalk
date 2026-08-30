const WEB_SEARCH_API_URL = "https://open.feedcoopapi.com/search_api/web_search";
const TRAFFIC_TAG_HEADER = "X-Traffic-Tag";
const TRAFFIC_TAG_VALUE = "skill_web_search_common";
const DEFAULT_COUNT = 10;
const MAX_WEB_COUNT = 50;
const MAX_IMAGE_COUNT = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const TIME_RANGE_SHORTCUTS = new Set(["OneDay", "OneWeek", "OneMonth", "OneYear"]);
const DATE_RANGE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

export type WebSearchType = "web" | "image";

export type WebSearchRequest = {
  query?: unknown;
  type?: unknown;
  count?: unknown;
  timeRange?: unknown;
  authLevel?: unknown;
  queryRewrite?: unknown;
};

type NormalizedWebSearchRequest = {
  query: string;
  type: WebSearchType;
  count: number;
  timeRange?: string;
  authLevel: 0 | 1;
  queryRewrite: boolean;
};

type SearchResult = {
  query: string;
  type: WebSearchType;
  resultCount: number;
  timeCostMs: number;
  results: Array<Record<string, unknown>>;
};

export class WebSearchServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "WebSearchServiceError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidParams(message = "搜索参数不合法") {
  return new WebSearchServiceError("WEB_SEARCH_INVALID_PARAMS", 400, message);
}

function validateTimeRange(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw invalidParams("timeRange 必须是字符串");

  const normalized = value.trim();
  if (TIME_RANGE_SHORTCUTS.has(normalized)) return normalized;

  const match = normalized.match(DATE_RANGE_PATTERN);
  if (!match) throw invalidParams("timeRange 必须是 OneDay/OneWeek/OneMonth/OneYear，或 YYYY-MM-DD..YYYY-MM-DD");

  const [, startText, endText] = match;
  const start = new Date(`${startText}T00:00:00.000Z`);
  const end = new Date(`${endText}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime())
    || Number.isNaN(end.getTime())
    || start.toISOString().slice(0, 10) !== startText
    || end.toISOString().slice(0, 10) !== endText
  ) {
    throw invalidParams("timeRange 中的日期必须是有效的 YYYY-MM-DD");
  }
  if (start > end) throw invalidParams("timeRange 的开始日期不能晚于结束日期");
  return normalized;
}

function normalizeRequest(input: WebSearchRequest): NormalizedWebSearchRequest {
  if (typeof input.query !== "string" || !input.query.trim()) {
    throw invalidParams("query 不能为空");
  }
  const query = input.query.trim();
  if (query.length > 100) throw invalidParams("query 最多 100 个字符");

  const type = input.type === undefined ? "web" : input.type;
  if (type !== "web" && type !== "image") throw invalidParams("type 只能是 web 或 image");

  const count = input.count === undefined ? DEFAULT_COUNT : input.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    throw invalidParams("count 必须是正整数");
  }
  const maxCount = type === "image" ? MAX_IMAGE_COUNT : MAX_WEB_COUNT;
  if (count > maxCount) throw invalidParams(`${type} 类型最多返回 ${maxCount} 条结果`);

  const authLevel = input.authLevel === undefined ? 0 : input.authLevel;
  if (authLevel !== 0 && authLevel !== 1) throw invalidParams("authLevel 只能是 0 或 1");
  if (input.queryRewrite !== undefined && typeof input.queryRewrite !== "boolean") {
    throw invalidParams("queryRewrite 必须是布尔值");
  }

  return {
    query,
    type,
    count,
    timeRange: validateTimeRange(input.timeRange),
    authLevel,
    queryRewrite: input.queryRewrite === true,
  };
}

function buildApiBody(input: NormalizedWebSearchRequest) {
  const body: Record<string, unknown> = {
    Query: input.query,
    SearchType: input.type,
    Count: input.count,
  };

  if (input.type === "web") {
    body.NeedSummary = true;
    if (input.authLevel > 0) body.Filter = { AuthInfoLevel: input.authLevel };
    if (input.timeRange) body.TimeRange = input.timeRange;
  }
  if (input.queryRewrite) body.QueryControl = { QueryRewrite: true };
  return body;
}

function errorFromUpstream(status: number, payload: unknown) {
  const metadata = isRecord(payload) && isRecord(payload.ResponseMetadata) ? payload.ResponseMetadata : null;
  const upstreamError = metadata && isRecord(metadata.Error) ? metadata.Error : null;
  const code = upstreamError && (typeof upstreamError.Code === "string" || typeof upstreamError.Code === "number")
    ? String(upstreamError.Code)
    : "";
  const codeText = code.toLowerCase();

  if (status === 401 || status === 403 || code === "10403" || codeText.includes("invalid_api_key")) {
    return new WebSearchServiceError("WEB_SEARCH_UPSTREAM_UNAUTHORIZED", 502, "Web Search 凭证无效或未获授权");
  }
  if (status === 429 || ["700429", "100018"].includes(code)) {
    return new WebSearchServiceError("WEB_SEARCH_UPSTREAM_RATE_LIMITED", 429, "Web Search 请求过于频繁，请稍后重试");
  }
  if (["10406", "10407", "10408", "10409", "10412"].includes(code)) {
    return new WebSearchServiceError("WEB_SEARCH_QUOTA_EXCEEDED", 429, "Web Search 额度不足或服务尚未开通");
  }
  if (status >= 500 || code === "10500") {
    return new WebSearchServiceError("WEB_SEARCH_UPSTREAM_UNAVAILABLE", 503, "Web Search 服务暂不可用，请稍后重试");
  }
  return new WebSearchServiceError("WEB_SEARCH_UPSTREAM_ERROR", 502, "Web Search 服务请求失败");
}

function normalizeResults(payload: unknown, input: NormalizedWebSearchRequest): SearchResult {
  if (!isRecord(payload) || !isRecord(payload.Result)) {
    throw new WebSearchServiceError("WEB_SEARCH_INVALID_RESPONSE", 502, "Web Search 服务返回格式无效");
  }

  const result = payload.Result;
  const rawResults = input.type === "web" ? result.WebResults : result.ImageResults;
  if (rawResults !== undefined && !Array.isArray(rawResults)) {
    throw new WebSearchServiceError("WEB_SEARCH_INVALID_RESPONSE", 502, "Web Search 服务返回格式无效");
  }

  const results = (rawResults || []).filter(isRecord).map((item) => {
    if (input.type === "web") {
      return {
        sortId: item.SortId,
        title: item.Title,
        url: item.Url,
        siteName: item.SiteName,
        summary: item.Summary || item.Snippet,
        authInfoDescription: item.AuthInfoDes,
      };
    }
    const image = isRecord(item.Image) ? item.Image : {};
    return {
      sortId: item.SortId,
      title: item.Title,
      url: image.Url,
      width: image.Width,
      height: image.Height,
      shape: image.Shape,
    };
  });

  return {
    query: input.query,
    type: input.type,
    resultCount: typeof result.ResultCount === "number" ? result.ResultCount : results.length,
    timeCostMs: typeof result.TimeCost === "number" ? result.TimeCost : 0,
    results,
  };
}

type RateEntry = { windowStartedAt: number; count: number };
const rateEntries = new Map<string, RateEntry>();

function consumeRateLimit(rateLimitKey: string) {
  const now = Date.now();
  for (const [key, entry] of rateEntries) {
    if (now - entry.windowStartedAt >= RATE_WINDOW_MS) rateEntries.delete(key);
  }

  const current = rateEntries.get(rateLimitKey);
  if (!current || now - current.windowStartedAt >= RATE_WINDOW_MS) {
    rateEntries.set(rateLimitKey, { windowStartedAt: now, count: 1 });
    return;
  }
  if (current.count >= RATE_LIMIT) {
    throw new WebSearchServiceError("WEB_SEARCH_RATE_LIMITED", 429, "Web Search 请求过于频繁，请稍后重试");
  }
  current.count += 1;
}

export async function searchWeb(input: WebSearchRequest, options: { rateLimitKey: string }) {
  const normalized = normalizeRequest(input);
  const apiKey = process.env.WEB_SEARCH_API_KEY?.trim();
  if (!apiKey) {
    throw new WebSearchServiceError("WEB_SEARCH_CREDENTIAL_NOT_CONFIGURED", 503, "宿主服务未配置 Web Search 凭证");
  }
  consumeRateLimit(options.rateLimitKey);

  let response: Response;
  try {
    response = await fetch(WEB_SEARCH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [TRAFFIC_TAG_HEADER]: TRAFFIC_TAG_VALUE,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildApiBody(normalized)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new WebSearchServiceError("WEB_SEARCH_UPSTREAM_UNAVAILABLE", 503, "Web Search 服务暂不可用，请稍后重试");
  }

  const text = await response.text().catch(() => "");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new WebSearchServiceError("WEB_SEARCH_INVALID_RESPONSE", 502, "Web Search 服务返回格式无效");
  }

  const metadata = isRecord(payload) && isRecord(payload.ResponseMetadata) ? payload.ResponseMetadata : null;
  if (!response.ok || (metadata && metadata.Error)) throw errorFromUpstream(response.status, payload);
  return normalizeResults(payload, normalized);
}
