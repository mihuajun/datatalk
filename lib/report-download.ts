export type ReportDownloadFormat = "pdf" | "png";

function captureReport(frame: HTMLIFrameElement | null, signal?: AbortSignal): Promise<string> {
  const target = frame?.contentWindow;
  if (!target) return Promise.reject(new Error("报表尚未加载完成，请稍后下载"));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new Error("下载已取消")); };
    const receive = (event: MessageEvent) => {
      if (event.source !== target || event.data?.type !== "__DATATALK_INSPECT_RESPONSE__" || event.data?.requestId !== requestId) return;
      cleanup();
      const data = event.data.capture?.dataUrl;
      if (event.data.ok && typeof data === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) && data.length <= 8 * 1024 * 1024) resolve(data);
      else reject(new Error("无法生成报表截图，请等待图表加载完成后重试；跨域图片也可能影响导出"));
    };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error("报表导出超时，请稍后重试")); }, 120_000);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    window.addEventListener("message", receive);
    target.postMessage({ type: "__DATATALK_INSPECT_REQUEST__", requestId, includeScreenshot: true, screenshotMode: "full", screenshotScale: 1 }, "*");
  });
}

function filename(name: string, format: ReportDownloadFormat) {
  const safe = Array.from(name.normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").trim()).slice(0, 100).join("").replace(/[. ]+$/, "");
  return `${safe || "报表"}.${format}`;
}

async function decodeImage(dataUrl: string) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { image.onload = null; image.onerror = null; reject(new Error("报表图片加载超时")); }, 15000);
    image.onload = () => { clearTimeout(timer); resolve(); };
    image.onerror = () => { clearTimeout(timer); reject(new Error("报表图片无效，请重新下载")); };
    image.src = dataUrl;
  });
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64_000_000) throw new Error("报表图片尺寸过大，请缩小报表后重试");
  return image;
}

/** Export the displayed report only, excluding the host toolbar. No upload. */
export async function createReportDownload(frame: HTMLIFrameElement | null, name: string, format: ReportDownloadFormat, signal?: AbortSignal) {
  const dataUrl = await captureReport(frame, signal);
  const image = await decodeImage(dataUrl);
  if (signal?.aborted) throw new Error("下载已取消");
  let blob: Blob;
  if (format === "png") {
    const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), char => char.charCodeAt(0));
    blob = new Blob([bytes], { type: "image/png" });
  } else {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    pdf.setProperties({ title: name, creator: "DataTalk Studio" });
    const width = image.naturalWidth, height = image.naturalHeight;
    const printableWidth = 190, printableHeight = 277; // A4 with 10 mm margins.
    const sliceHeight = Math.max(1, Math.floor(width * printableHeight / printableWidth));
    if (Math.ceil(height / sliceHeight) > 100) throw new Error("报表过长，无法导出超过 100 页的 PDF");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    for (let top = 0, page = 0; top < height; top += sliceHeight, page++) {
      if (signal?.aborted) throw new Error("下载已取消");
      canvas.height = Math.min(sliceHeight, height - top);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前浏览器无法生成 PDF");
      context.fillStyle = "#fff"; context.fillRect(0, 0, width, canvas.height);
      context.drawImage(image, 0, top, width, canvas.height, 0, 0, width, canvas.height);
      if (page > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 10, 10, printableWidth, canvas.height * printableWidth / width);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    canvas.width = canvas.height = 0;
    blob = pdf.output("blob");
  }
  return { blob, filename: filename(name, format) };
}

export function triggerReportDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
}
