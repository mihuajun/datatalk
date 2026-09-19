import { getConfiguredAgentModelCredentials } from "@/lib/server/agent-runtime";

export const DATATALK_IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
export const DATATALK_IMAGE_QUALITIES = ["low", "medium", "high"] as const;
export const DATATALK_IMAGE_BACKGROUNDS = ["auto", "opaque", "transparent"] as const;
export const DATATALK_IMAGE_OUTPUT_FORMATS = ["png", "webp", "jpeg"] as const;

export type DataTalkImageSize = (typeof DATATALK_IMAGE_SIZES)[number];
export type DataTalkImageQuality = (typeof DATATALK_IMAGE_QUALITIES)[number];
export type DataTalkImageBackground = (typeof DATATALK_IMAGE_BACKGROUNDS)[number];
export type DataTalkImageOutputFormat = (typeof DATATALK_IMAGE_OUTPUT_FORMATS)[number];

export type DataTalkImageGenerationInput = {
  prompt?: unknown;
  size?: unknown;
  quality?: unknown;
  background?: unknown;
  outputFormat?: unknown;
};

export type NormalizedDataTalkImageGenerationInput = {
  prompt: string;
  size: DataTalkImageSize;
  quality: DataTalkImageQuality;
  background: DataTalkImageBackground;
  outputFormat: DataTalkImageOutputFormat;
};

export type DataTalkGeneratedImage = NormalizedDataTalkImageGenerationInput & {
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  revisedPrompt?: string;
};

const MAX_PROMPT_LENGTH = 8_000;
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 5;
const MAX_CONCURRENT_REQUESTS = 2;

type GenerationState = {
  active: number;
  starts: number[];
};

const generationStateByUser = new Map<number, GenerationState>();

function requiredEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error("IMAGE_GENERATION_INVALID_PARAMS");
  }
  return value as T;
}

export function normalizeDataTalkImageGenerationInput(input: DataTalkImageGenerationInput): NormalizedDataTalkImageGenerationInput {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) throw new Error("IMAGE_PROMPT_REQUIRED");
  if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("IMAGE_PROMPT_TOO_LONG");

  const outputFormat = requiredEnum(input.outputFormat, DATATALK_IMAGE_OUTPUT_FORMATS, "webp");
  const background = requiredEnum(input.background, DATATALK_IMAGE_BACKGROUNDS, "auto");
  if (background === "transparent" && outputFormat === "jpeg") {
    throw new Error("IMAGE_GENERATION_INVALID_PARAMS");
  }

  return {
    prompt,
    size: requiredEnum(input.size, DATATALK_IMAGE_SIZES, "1024x1024"),
    quality: requiredEnum(input.quality, DATATALK_IMAGE_QUALITIES, "medium"),
    background,
    outputFormat,
  };
}

function hasPrefix(bytes: Buffer, prefix: readonly number[]) {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

export function detectGeneratedImageType(bytes: Buffer): DataTalkGeneratedImage["mediaType"] | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  return null;
}

export function decodeGeneratedImageBase64(value: unknown) {
  if (typeof value !== "string") throw new Error("IMAGE_GENERATION_INVALID_RESPONSE");
  const base64 = value.trim();
  const maxBase64Length = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
  if (!base64 || base64.length > maxBase64Length || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error(base64.length > maxBase64Length ? "IMAGE_GENERATION_RESULT_TOO_LARGE" : "IMAGE_GENERATION_INVALID_RESPONSE");
  }

  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("IMAGE_GENERATION_RESULT_TOO_LARGE");
  const mediaType = detectGeneratedImageType(bytes);
  if (!mediaType) throw new Error("IMAGE_GENERATION_INVALID_RESPONSE");
  return { base64, bytes, mediaType };
}

function beginGeneration(userId: number) {
  const now = Date.now();
  for (const [key, value] of generationStateByUser) {
    value.starts = value.starts.filter((startedAt) => startedAt > now - RATE_LIMIT_WINDOW_MS);
    if (value.active === 0 && value.starts.length === 0) generationStateByUser.delete(key);
  }

  const state = generationStateByUser.get(userId) || { active: 0, starts: [] };
  if (state.active >= MAX_CONCURRENT_REQUESTS) throw new Error("IMAGE_GENERATION_BUSY");
  if (state.starts.length >= RATE_LIMIT_REQUESTS) throw new Error("IMAGE_GENERATION_RATE_LIMITED");
  state.active += 1;
  state.starts.push(now);
  generationStateByUser.set(userId, state);

  return () => {
    state.active = Math.max(0, state.active - 1);
  };
}

function createRequestSignal(callerSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("IMAGE_GENERATION_TIMEOUT"));
  }, REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

async function readResponseText(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("IMAGE_GENERATION_RESULT_TOO_LARGE");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function generateDataTalkImage(input: {
  userId: number;
  args: DataTalkImageGenerationInput;
  signal?: AbortSignal;
}): Promise<DataTalkGeneratedImage> {
  const request = normalizeDataTalkImageGenerationInput(input.args);
  const config = getConfiguredAgentModelCredentials();
  if (!config?.imageModel) throw new Error("IMAGE_MODEL_NOT_CONFIGURED");

  const finishGeneration = beginGeneration(input.userId);
  const requestSignal = createRequestSignal(input.signal);
  try {
    const response = await fetch(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.imageModel,
        prompt: request.prompt,
        size: request.size,
        quality: request.quality,
        background: request.background,
        output_format: request.outputFormat,
        output_compression: request.outputFormat === "png" ? undefined : 85,
        n: 1,
      }),
      signal: requestSignal.signal,
    });

    if (!response.ok) {
      const detail = (await readResponseText(response, 4_096)).slice(0, 1_000);
      console.error("DataTalk image generation upstream request failed", { status: response.status, detail });
      throw new Error("IMAGE_GENERATION_UPSTREAM_ERROR");
    }

    const raw = await readResponseText(response, MAX_RESPONSE_BYTES);
    let payload: { data?: Array<{ b64_json?: unknown; revised_prompt?: unknown }> };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      throw new Error("IMAGE_GENERATION_INVALID_RESPONSE");
    }
    const item = payload.data?.[0];
    const decoded = decodeGeneratedImageBase64(item?.b64_json);
    return {
      ...request,
      base64: decoded.base64,
      mediaType: decoded.mediaType,
      bytes: decoded.bytes.byteLength,
      ...(typeof item?.revised_prompt === "string" && item.revised_prompt.trim()
        ? { revisedPrompt: item.revised_prompt.trim() }
        : {}),
    };
  } catch (error) {
    if (requestSignal.timedOut()) throw new Error("IMAGE_GENERATION_TIMEOUT");
    if (input.signal?.aborted) throw new Error("IMAGE_GENERATION_CANCELLED");
    if (error instanceof Error && error.message.startsWith("IMAGE_")) throw error;
    console.error("DataTalk image generation request failed", { error });
    throw new Error("IMAGE_GENERATION_UPSTREAM_ERROR");
  } finally {
    requestSignal.cleanup();
    finishGeneration();
  }
}
