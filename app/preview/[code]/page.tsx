import { notFound, redirect } from "next/navigation";

import { ReportWebFrame } from "@/components/report-web-frame";
import { resolveReportFilterValues, toReportSearchParams, type ReportPageSearchParams } from "@/lib/report-filters";
import { composeWebReportSrcDoc, toWebReportFiles } from "@/lib/report-web";
import { getAuthSession } from "@/lib/server/auth-session";
import { getReportDetailByCode } from "@/lib/server/report-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isValidReportCode(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(value);
}

export default async function ReportPreviewPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams?: Promise<ReportPageSearchParams> }) {
  const session = await getAuthSession();
  if (!session) redirect("/");

  const { code } = await params;
  const reportCode = code.trim();
  if (!isValidReportCode(reportCode)) notFound();

  const result = await getReportDetailByCode(session.tenantId, reportCode);
  if (!result) notFound();

  const webFiles = result.webFiles["page.html"]
    ? result.webFiles
    : result.definition
      ? toWebReportFiles(result.definition)
      : result.webFiles;
  const filterResolution = resolveReportFilterValues(result.filterManifest, toReportSearchParams(await searchParams));

  return (
    <main className="min-h-screen bg-[#F4F7FB]">
      <ReportWebFrame
        className="block min-h-screen w-full border-0 bg-[#F4F7FB]"
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
