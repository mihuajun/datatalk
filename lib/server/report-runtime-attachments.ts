import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const RUNTIME_ATTACHMENT_MAX_FILES = 10;
export const RUNTIME_ATTACHMENT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const RUNTIME_ATTACHMENT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const RUNTIME_ATTACHMENT_DIRECTORY = "runtime/incoming";
const allowedExtensions = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".tsv",
  ".pdf",
  ".docx",
  ".xlsx",
  ".xls",
  ".html",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

export type RuntimeAttachmentInput = {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type RuntimeAttachment = {
  name: string;
  relativePath: string;
  size: number;
};

export type StagedRuntimeAttachments = {
  directoryPath: string | null;
  files: RuntimeAttachment[];
};

function attachmentError(message: string) {
  return new Error(message);
}

function sanitizeAttachmentName(name: string, index: number) {
  const leafName = path.basename(name.replaceAll("\\", "/"));
  const normalized = leafName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/^\.+$/, "")
    .slice(0, 160);
  if (!normalized) return `attachment-${index + 1}`;
  return normalized;
}

function uniqueAttachmentName(name: string, usedNames: Set<string>) {
  if (!usedNames.has(name.toLowerCase())) {
    usedNames.add(name.toLowerCase());
    return name;
  }

  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  let suffix = 1;
  let candidate = `${stem} (${suffix})${extension}`;
  while (usedNames.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${stem} (${suffix})${extension}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function validateAttachmentInput(file: RuntimeAttachmentInput, index: number) {
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw attachmentError("附件大小无效");
  if (file.size > RUNTIME_ATTACHMENT_MAX_FILE_BYTES) {
    throw attachmentError(`单个附件不能超过 ${RUNTIME_ATTACHMENT_MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  const name = sanitizeAttachmentName(file.name, index);
  const extension = path.extname(name).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw attachmentError("附件格式不受支持，请上传 TXT、MD、JSON、CSV、PDF、DOCX、XLSX、HTML 或常见图片文件");
  }
  return name;
}

export async function stageRuntimeAttachments(input: {
  workingDirectory: string;
  files: RuntimeAttachmentInput[];
}): Promise<StagedRuntimeAttachments> {
  if (!input.files.length) return { directoryPath: null, files: [] };
  if (input.files.length > RUNTIME_ATTACHMENT_MAX_FILES) {
    throw attachmentError(`一次最多上传 ${RUNTIME_ATTACHMENT_MAX_FILES} 个附件`);
  }

  const totalBytes = input.files.reduce((total, file) => total + file.size, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > RUNTIME_ATTACHMENT_MAX_TOTAL_BYTES) {
    throw attachmentError(`附件总大小不能超过 ${RUNTIME_ATTACHMENT_MAX_TOTAL_BYTES / 1024 / 1024} MB`);
  }

  const requestId = `req_${randomUUID()}`;
  const directoryPath = path.join(input.workingDirectory, RUNTIME_ATTACHMENT_DIRECTORY, requestId);
  const usedNames = new Set<string>();
  const stagedFiles: RuntimeAttachment[] = [];

  await fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
  try {
    for (const [index, file] of input.files.entries()) {
      const name = uniqueAttachmentName(validateAttachmentInput(file, index), usedNames);
      const temporaryPath = path.join(directoryPath, `.part-${index}-${randomUUID()}`);
      const targetPath = path.join(directoryPath, name);
      const data = Buffer.from(await file.arrayBuffer());
      if (data.byteLength !== file.size) throw attachmentError("附件读取失败，请重试");
      await fs.writeFile(temporaryPath, data, { mode: 0o600 });
      await fs.rename(temporaryPath, targetPath);
      stagedFiles.push({
        name,
        relativePath: `${RUNTIME_ATTACHMENT_DIRECTORY}/${requestId}/${name}`,
        size: file.size,
      });
    }
    return { directoryPath, files: stagedFiles };
  } catch (error) {
    await fs.rm(directoryPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function cleanupRuntimeAttachments(directoryPath: string | null) {
  if (!directoryPath) return;
  await fs.rm(directoryPath, { recursive: true, force: true }).catch(() => undefined);
}
