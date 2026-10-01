import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { getAuthSession } from "@/lib/server/auth-session";
import { executeReportDataRequest, getTenantReportRuntimeTarget } from "@/lib/server/report-data-runtime";
import { getReportWorkingPath } from "@/lib/server/report-workspace";
import { getDbPool } from "@/lib/server/mysql";
import type { RowDataPacket } from "mysql2/promise";

const MAX_EMBEDDED_ROWS = 1000;

function parseReportCode(value: string) {
  const code = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(code) ? code : null;
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ message: "未登录" }, { status: 401 });

  const reportCode = parseReportCode((await params).id);
  if (!reportCode) return NextResponse.json({ message: "报表编码不正确" }, { status: 400 });

  const target = await getTenantReportRuntimeTarget(session.tenantId, reportCode);
  if (!target) return NextResponse.json({ message: "报表不存在" }, { status: 404 });

  const workingPath = getReportWorkingPath(target.tenantId, target.reportCode);
  const [pageHtml, stylesCss, appJs, reportJsonRaw] = await Promise.all([
    fs.readFile(path.join(workingPath, "page.html"), "utf8"),
    fs.readFile(path.join(workingPath, "styles.css"), "utf8"),
    fs.readFile(path.join(workingPath, "app.js"), "utf8"),
    fs.readFile(path.join(workingPath, "report.json"), "utf8").catch(() => "{}"),
  ]);

  let reportTitle = reportCode;
  try {
    const reportJson = JSON.parse(reportJsonRaw) as { title?: string };
    if (typeof reportJson.title === "string" && reportJson.title.trim()) reportTitle = reportJson.title.trim();
  } catch {
    // Ignore invalid report.json, use code as title.
  }

  // Execute server.js handlers to fetch data
  const { validateWorkingReportRuntime } = await import("@/lib/server/report-data-runtime");
  const { handlerIds } = await validateWorkingReportRuntime(target.tenantId, target.reportCode);
  const embeddedData: Record<string, unknown> = {};
  let truncated = false;
  const errors: string[] = [];

  for (const dataId of handlerIds) {
    try {
      const result = await executeReportDataRequest({
        tenantId: target.tenantId,
        reportCode: target.reportCode,
        source: "working",
        dataId,
      });
      if (Array.isArray(result) && result.length > MAX_EMBEDDED_ROWS) {
        embeddedData[dataId] = result.slice(0, MAX_EMBEDDED_ROWS);
        truncated = true;
      } else {
        embeddedData[dataId] = result;
      }
    } catch (error) {
      errors.push(`数据 ${dataId}: ${error instanceof Error ? error.message : "查询失败"}`);
      embeddedData[dataId] = [];
    }
  }

  const hasDataError = errors.length > 0;
  const embeddedDataJson = JSON.stringify(embeddedData).replace(/<\//g, "<\\/");

  // Build the bridge script that overrides window.reportRuntime.query
  const bridgeScript = `
<script>
(function() {
  var __EMBEDDED_DATA__ = ${embeddedDataJson};
  window.__EMBEDDED_DATA__ = __EMBEDDED_DATA__;
  window.__EMBEDDED_DATA_TRUNCATED__ = ${truncated};
  window.__EMBEDDED_DATA_ERROR__ = ${hasDataError ? JSON.stringify(errors.join("；")) : "null"};

  if (!window.reportRuntime) {
    window.reportRuntime = {};
  }
  window.reportRuntime.query = function(dataId, filters) {
    return new Promise(function(resolve, reject) {
      if (Object.prototype.hasOwnProperty.call(__EMBEDDED_DATA__, dataId)) {
        resolve(__EMBEDDED_DATA__[dataId]);
      } else {
        reject(new Error("未找到嵌入数据: " + dataId));
      }
    });
  };
})();
</script>`;

  // Inject bridge script into page.html, before any existing scripts
  let html = pageHtml;
  if (html.includes("<head>")) {
    html = html.replace("<head>", "<head>" + bridgeScript);
  } else if (html.includes("<html>")) {
    html = html.replace("<html>", "<html><head>" + bridgeScript + "</head>");
  } else {
    html = bridgeScript + html;
  }

  // Inline styles.css
  html = html.replace(/<link[^>]*href=["']styles\.css["'][^>]*>/gi, "");
  if (html.includes("</head>")) {
    html = html.replace("</head>", "<style>" + stylesCss + "</style></head>");
  } else {
    html += "<style>" + stylesCss + "</style>";
  }

  // Inline app.js
  html = html.replace(/<script[^>]*src=["']app\.js["'][^>]*><\/script>/gi, "");
  if (html.includes("</body>")) {
    html = html.replace("</body>", "<script>" + appJs + "</script></body>");
  } else {
    html += "<script>" + appJs + "</script>";
  }

  // Add watermark banner if data truncated or error
  if (truncated || hasDataError) {
    const watermarkText = truncated
      ? "数据已截断（最多嵌入1000条），完整数据请访问在线版本"
      : "部分数据加载失败，导出内容可能不完整";
    const banner = '<div style="position:fixed;bottom:0;left:0;right:0;background:#F79009;color:#fff;text-align:center;padding:8px 12px;font-size:12px;z-index:99999;">' + escapeHtml(watermarkText) + "</div>";
    if (html.includes("</body>")) {
      html = html.replace("</body>", banner + "</body>");
    } else {
      html += banner;
    }
  }

  // Fetch report name from DB for filename
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT name FROM tenant_report WHERE tenant_id=? AND code=? LIMIT 1",
    [session.tenantId, reportCode],
  );
  const reportName = (rows[0]?.name as string)?.trim() || reportTitle;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fileName = `${reportName}_${dateStr}.html`.replace(/[/\\?%*:|"<>]/g, "_");

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
