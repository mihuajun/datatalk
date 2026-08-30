import { ReportEditorPageClient } from "@/app/reports/editor/page";

export default async function ReportEditorCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  return <ReportEditorPageClient reportCode={code} />;
}
