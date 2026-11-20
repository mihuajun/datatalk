import type { Metadata } from "next";
import { cache } from "react";
import { getReportPreviewSession } from "@/lib/server/studio-preview";
import { notFound, redirect } from "next/navigation";

import { ReportWebFrame } from "@/components/report-web-frame";
import { resolveReportFilterValues, toReportSearchParams, type ReportPageSearchParams } from "@/lib/report-filters";
import { composeWebReportSrcDoc, toWebReportFiles } from "@/lib/report-web";
import { getAuthSession } from "@/lib/server/auth-session";
import { getReportDetailByCode } from "@/lib/server/report-repository";
import { isWorkBuddyLoginConfigured } from "@/lib/server/workbuddy-oauth";
import { WorkBuddyPreviewToolbar } from "./workbuddy-toolbar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isValidReportCode(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(value);
}

type PreviewPageProps = { params: Promise<{ code: string }>; searchParams?: Promise<ReportPageSearchParams> };

// Share authorization and report loading between metadata and page rendering.
const loadPreviewContext = cache(async (reportCode: string, workBuddyTools: boolean) => {
  const previewSession = await getReportPreviewSession(reportCode);
  const authSession = await getAuthSession();
  const session = workBuddyTools ? authSession : (previewSession || authSession);
  const result = session ? await getReportDetailByCode(session.tenantId, reportCode) : null;
  return { authSession, session, result };
});

export async function generateMetadata({ params, searchParams }: PreviewPageProps): Promise<Metadata> {
  const reportCode = (await params).code.trim();
  if (!isValidReportCode(reportCode)) return { title: "DataTalk Studio" };
  const query = await searchParams;
  const { result } = await loadPreviewContext(reportCode, query?.workbuddyTools === "1");
  // Never disclose a report name before the viewer passes tenant authorization.
  return { title: { absolute: result?.report.name || "DataTalk Studio" } };
}

export default async function ReportPreviewPage({ params, searchParams }: PreviewPageProps) {
  const { code } = await params;
  const reportCode = code.trim();
  if (!isValidReportCode(reportCode)) notFound();

  const query = await searchParams;
  const workBuddyTools = query?.workbuddyTools === "1";
  const { authSession, session, result } = await loadPreviewContext(reportCode, workBuddyTools);
  if (workBuddyTools && !authSession && isWorkBuddyLoginConfigured()) {
    const returnParams = toReportSearchParams(query);
    returnParams.set("workbuddyTools", "1");
    const returnTo = `/preview/${encodeURIComponent(reportCode)}?${returnParams.toString()}`;
    redirect(`/api/auth/workbuddy?next=${encodeURIComponent(returnTo)}`);
  }
  if (!session) return <main className="flex min-h-screen items-center justify-center bg-[#F4F7FB] p-6"><div className="max-w-md rounded-xl bg-white p-8"><h1 className="text-xl font-bold">预览会话已结束</h1><p className="mt-4 text-sm leading-6 text-[#526174]">请从来源应用重新获取这份报表的预览链接。也可以登录工作台后查看。</p><a className="mt-5 inline-block text-sm text-[#2167E8]" href={`/?next=${encodeURIComponent(`/preview/${reportCode}`)}`}>登录工作台</a></div></main>;
  if (!result) notFound();

  const webFiles = result.webFiles["page.html"]
    ? result.webFiles
    : result.definition
      ? toWebReportFiles(result.definition)
      : result.webFiles;
  const filterResolution = resolveReportFilterValues(result.filterManifest, toReportSearchParams(query));

  return (
    <main data-workbuddy-preview className="min-h-screen bg-[#F4F7FB]">
      {workBuddyTools ? <WorkBuddyPreviewToolbar reportCode={reportCode} /> : null}
      <ReportWebFrame
        className={`block ${workBuddyTools ? "min-h-[calc(100vh-2.75rem)]" : "min-h-screen"} w-full border-0 bg-[#F4F7FB]`}
        title={result.report.name}
        reportCode={reportCode}
        source="working"
        srcDoc={composeWebReportSrcDoc(webFiles, { filters: filterResolution.values, urlFilters: filterResolution.urlValues, defaults: filterResolution.defaults })}
        refreshKey={`${reportCode}-${result.workingCommitHash || "working"}-${JSON.stringify(filterResolution.values)}`}
        horizontalOverflowMode="auto"
      />
    </main>
  );
}
