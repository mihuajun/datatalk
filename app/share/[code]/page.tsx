import { notFound } from "next/navigation";

import { ReportWebFrame } from "@/components/report-web-frame";
import { resolveReportFilterValues, toReportSearchParams, type ReportPageSearchParams } from "@/lib/report-filters";
import { composeWebReportSrcDoc } from "@/lib/report-web";
import { getReportReleaseDetailByCode } from "@/lib/server/report-repository";
import { getPublishedResourceReportTarget, incrementPublishedResourceView } from "@/lib/server/resource-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isValidReportCode(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(value);
}

export default async function SharedResourceReportPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams?: Promise<ReportPageSearchParams> }) {
  const { code } = await params;
  const reportCode = code.trim();
  if (!isValidReportCode(reportCode)) notFound();

  const resourceTarget = await getPublishedResourceReportTarget(reportCode);
  if (!resourceTarget) notFound();

  const result = await getReportReleaseDetailByCode(resourceTarget.tenantId, resourceTarget.reportCode, resourceTarget.version);
  if (!result) notFound();
  await incrementPublishedResourceView(resourceTarget);

  const filterResolution = resolveReportFilterValues(result.filterManifest, toReportSearchParams(await searchParams));

  return (
    <main className="min-h-screen bg-[#F4F7FB]">
      <ReportWebFrame
        className="block min-h-screen w-full border-0 bg-[#F4F7FB]"
        title={result.report.name}
        reportCode={resourceTarget.reportCode}
        source="release"
        runtimeTarget="resource"
        srcDoc={composeWebReportSrcDoc(result.webFiles, { filters: filterResolution.values, urlFilters: filterResolution.urlValues, defaults: filterResolution.defaults })}
        refreshKey={`${resourceTarget.reportCode}-resource-${resourceTarget.version}-${JSON.stringify(filterResolution.values)}`}
      />
    </main>
  );
}
