const reportCodePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/;
const imageExtensions = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const artifactExtensions = new Set([
  ...imageExtensions,
  "csv",
  "docx",
  "html",
  "json",
  "md",
  "pdf",
  "pptx",
  "tsv",
  "txt",
  "xls",
  "xlsx",
]);

export type ReportAiArtifact = {
  fileName: string;
  relativePath: string;
  url: string;
  isImage: boolean;
};

function artifactExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex < 0 ? "" : fileName.slice(dotIndex + 1).toLowerCase();
}

export function isAllowedReportAiArtifactPath(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return false;
  }
  if (segments[0] === "runtime") return false;
  return artifactExtensions.has(artifactExtension(segments.at(-1) || ""));
}

export function isReportAiImageArtifact(relativePath: string) {
  const fileName = relativePath.replaceAll("\\", "/").split("/").at(-1) || "";
  return imageExtensions.has(artifactExtension(fileName));
}

export function reportAiArtifactUrl(reportCode: string, relativePath: string) {
  const encodedPath = relativePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `/api/reports/${encodeURIComponent(reportCode)}/workspace-files/${encodedPath}`;
}

export function resolveReportAiSandboxArtifact(href: string, reportCode: string | null | undefined): ReportAiArtifact | null {
  if (!reportCode || !reportCodePattern.test(reportCode)) return null;

  let sandboxUrl: URL;
  try {
    sandboxUrl = new URL(href.trim());
  } catch {
    return null;
  }
  if (sandboxUrl.protocol !== "sandbox:") return null;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(sandboxUrl.pathname).replaceAll("\\", "/");
  } catch {
    return null;
  }

  const segments = decodedPath.split("/").filter(Boolean);
  const workingIndex = segments.lastIndexOf("working");
  if (workingIndex < 1 || segments[workingIndex - 1] !== reportCode) return null;

  const relativeSegments = segments.slice(workingIndex + 1);
  const relativePath = relativeSegments.join("/");
  if (!isAllowedReportAiArtifactPath(relativePath)) return null;

  const fileName = relativeSegments.at(-1) || "";
  return {
    fileName,
    relativePath,
    url: reportAiArtifactUrl(reportCode, relativePath),
    isImage: isReportAiImageArtifact(relativePath),
  };
}

export function reportAiArtifactDownloadUrl(artifact: ReportAiArtifact) {
  return `${artifact.url}?download=1`;
}
