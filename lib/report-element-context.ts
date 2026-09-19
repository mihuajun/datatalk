export type ReportSelectedElement = {
  selector: string;
  tag: string;
  text: string;
  workspaceFingerprint: string;
};

const elementContextMarker = "当前选中的报表元素（定位信息，请核对最新 working 页面）：\n";
const attachmentContextMarker = "\n\n本轮对话包含以下临时附件：";

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

export function withSelectedElementContext(message: string, selected: ReportSelectedElement[]) {
  if (!selected.length) return message;
  return `${message ? `${message}\n\n` : ""}${elementContextMarker}${JSON.stringify(selected)}`;
}

export function readSelectedElementContext(content: string): { message: string; selected: ReportSelectedElement[] } {
  const normalizedContent = normalizeLineEndings(content);
  const markerIndex = normalizedContent.lastIndexOf(elementContextMarker);
  if (markerIndex < 0) return { message: normalizedContent, selected: [] };
  const contextStart = markerIndex + elementContextMarker.length;
  const attachmentStart = normalizedContent.indexOf(attachmentContextMarker, contextStart);
  const visibleMessage = normalizedContent.slice(0, markerIndex).trimEnd()
    + (attachmentStart < 0 ? "" : normalizedContent.slice(attachmentStart));
  try {
    const value: unknown = JSON.parse(normalizedContent.slice(contextStart, attachmentStart < 0 ? undefined : attachmentStart).trim());
    const targets: unknown[] = Array.isArray(value) ? value : [value];
    if (!targets.length || targets.some((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return true;
      const target = value as Partial<ReportSelectedElement>;
      return typeof target.selector !== "string" || !target.selector || target.selector.length > 500
        || typeof target.tag !== "string" || !target.tag || target.tag.length > 60
        || typeof target.text !== "string" || target.text.length > 240
        || typeof target.workspaceFingerprint !== "string" || target.workspaceFingerprint.length > 100;
    })) throw new Error("Invalid element context");
    return { message: visibleMessage.trim(), selected: targets as ReportSelectedElement[] };
  } catch {
    return { message: visibleMessage.trim(), selected: [] };
  }
}

export function runtimeMessageMatchesPending(content: string, message: string) {
  const visibleContent = normalizeLineEndings(content).trim();
  const normalizedMessage = normalizeLineEndings(message).trim();
  if (!normalizedMessage) return !visibleContent || visibleContent.startsWith(attachmentContextMarker.trim());
  return visibleContent === normalizedMessage || visibleContent.startsWith(`${normalizedMessage}${attachmentContextMarker}`);
}
