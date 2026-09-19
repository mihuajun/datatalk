import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { defineTool } from "../../deepseek-harness/node_modules/@deepseek-ai/dsh-tools/lib/index.js";

export const name = "datatalk-image-gen";
export const inject = ["tools", "attachments"];

function resolveBaseUrl() {
  const value = (process.env.REPORT_AGENT_TOOLS_BASE_URL || "").trim().replace(/\/+$/, "");
  if (value) return value;
  const port = (process.env.PORT || "3000").trim();
  return `http://127.0.0.1:${port}`;
}

async function requestImage(args, exec) {
  const dshSessionId = exec.agent?.id;
  if (!dshSessionId) throw new Error("REPORT_AGENT_TOOL_SESSION_NOT_FOUND");

  const response = await fetch(`${resolveBaseUrl()}/api/report-agent-tools`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-report-agent-dsh-session-id": dshSessionId,
    },
    body: JSON.stringify({ tool: "datatalk-image-gen", args }),
    signal: exec.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.message === "string" ? payload.message : `HTTP_${response.status}`);
  }
  return payload.result;
}

function extensionForMediaType(mediaType) {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/jpeg") return "jpeg";
  if (mediaType === "image/webp") return "webp";
  throw new Error("IMAGE_GENERATION_INVALID_RESPONSE");
}

async function saveReportAsset(bytes, mediaType, exec) {
  const cwd = exec.agent?.session?.header?.cwd;
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    throw new Error("REPORT_AGENT_WORKSPACE_NOT_FOUND");
  }

  const relativeDirectory = path.join("assets", "generated");
  const directory = path.join(cwd, relativeDirectory);
  const assetId = randomUUID();
  const fileName = `${assetId}.${extensionForMediaType(mediaType)}`;
  const destination = path.join(directory, fileName);
  const temporary = path.join(directory, `.${fileName}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  const relativePath = path.posix.join("assets", "generated", fileName);
  return {
    assetId,
    absolutePath: destination,
    relativePath,
    assetUrl: `datatalk-asset://${relativePath}`,
    name: fileName,
  };
}

function renderImageResult(value) {
  const { attachment, ...metadata } = value && typeof value === "object" ? value : { value };
  const content = [{ type: "text", text: JSON.stringify(metadata) }];
  if (attachment?.attachmentId) content.push({ type: "image", attachment });
  return content;
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "datatalk-image-gen",
    description: "使用 DataTalk 设置中的图片模型生成一张位图。适用于照片、插画、背景、封面和纹理；图表、KPI、表格和简单矢量图应使用报表原生 HTML/CSS/ECharts/SVG。报表任务默认保存到当前工作区并返回稳定 assetUrl；接入或预览失败时复用已有资产，不要重新调用本 Tool。用户明确只要对话图片时才选择 conversation_only。",
    timeoutMs: 190000,
    parameters: {
      prompt: { type: "string", required: true, description: "完整、具体的图片描述。不要包含模型名称或 API 凭据。" },
      size: { type: "string", enum: ["1024x1024", "1536x1024", "1024x1536"], description: "输出尺寸，默认 1024x1024。" },
      quality: { type: "string", enum: ["low", "medium", "high"], description: "生成质量，默认 medium。" },
      background: { type: "string", enum: ["auto", "opaque", "transparent"], description: "背景模式，默认 auto；透明背景需配合 PNG 或 WebP。" },
      outputFormat: { type: "string", enum: ["png", "webp", "jpeg"], description: "输出格式，默认 webp。" },
      saveMode: { type: "string", enum: ["report_asset", "conversation_only"], description: "report_asset 保存到当前报表并返回附件；conversation_only 仅返回对话附件。默认 report_asset。" },
    },
    async execute(args, exec) {
      const saveMode = args.saveMode === "conversation_only" ? "conversation_only" : "report_asset";
      const result = await requestImage({
        prompt: args.prompt,
        size: args.size,
        quality: args.quality,
        background: args.background,
        outputFormat: args.outputFormat,
      }, exec);
      if (!result || typeof result.base64 !== "string" || typeof result.mediaType !== "string") {
        throw new Error("IMAGE_GENERATION_INVALID_RESPONSE");
      }

      const bytes = Buffer.from(result.base64, "base64");
      const asset = saveMode === "report_asset" ? await saveReportAsset(bytes, result.mediaType, exec) : null;
      let attachment = null;
      let attachmentError = null;
      try {
        const attachments = ctx.get("attachments");
        if (!attachments || typeof attachments.saveImage !== "function") {
          throw new Error("IMAGE_GENERATION_ATTACHMENT_UNAVAILABLE");
        }
        attachment = await attachments.saveImage({
          data: Uint8Array.from(bytes),
          mediaType: result.mediaType,
          name: asset?.name || `generated-image.${extensionForMediaType(result.mediaType)}`,
        });
      } catch (error) {
        if (!asset) throw error;
        attachmentError = error instanceof Error && error.message === "IMAGE_GENERATION_ATTACHMENT_UNAVAILABLE"
          ? error.message
          : "IMAGE_GENERATION_ATTACHMENT_FAILED";
      }
      const { base64: _base64, ...metadata } = result;
      return {
        ok: true,
        ...metadata,
        saveMode,
        ...(asset ? { assetId: asset.assetId, relativePath: asset.relativePath, assetUrl: asset.assetUrl } : {}),
        ...(attachment ? { attachment } : { attachmentAvailable: false, attachmentError }),
      };
    },
    output: {
      schema: { type: "json" },
      render: (_args, value) => renderImageResult(value),
    },
  }));
}
