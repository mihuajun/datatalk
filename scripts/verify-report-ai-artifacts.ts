import assert from "node:assert/strict";

import {
  isAllowedReportAiArtifactPath,
  reportAiArtifactDownloadUrl,
  resolveReportAiSandboxArtifact,
} from "@/lib/report-ai-artifacts";

const reportCode = "2082c57f26904545a070a44ec13c1447";
const productionArtifact = resolveReportAiSandboxArtifact(
  `sandbox:/app/workspace/data/1/${reportCode}/working/chick-eating-rice.svg`,
  reportCode,
);
assert.deepEqual(productionArtifact, {
  fileName: "chick-eating-rice.svg",
  relativePath: "chick-eating-rice.svg",
  url: `/api/reports/${reportCode}/workspace-files/chick-eating-rice.svg`,
  isImage: true,
});
assert.equal(reportAiArtifactDownloadUrl(productionArtifact!), `${productionArtifact!.url}?download=1`);

const nestedArtifact = resolveReportAiSandboxArtifact(
  `sandbox:/Users/dev/datatalk-workspace/data/1/${reportCode}/working/assets/%E7%BB%93%E6%9E%9C%20%E5%9B%BE.png`,
  reportCode,
);
assert.equal(nestedArtifact?.relativePath, "assets/结果 图.png");
assert.equal(nestedArtifact?.url, `/api/reports/${reportCode}/workspace-files/assets/%E7%BB%93%E6%9E%9C%20%E5%9B%BE.png`);

assert.equal(resolveReportAiSandboxArtifact(`sandbox:/app/workspace/data/1/another-report/working/image.png`, reportCode), null);
assert.equal(resolveReportAiSandboxArtifact(`sandbox:/app/workspace/data/1/${reportCode}/working/../secret.png`, reportCode), null);
assert.equal(resolveReportAiSandboxArtifact(`file:/app/workspace/data/1/${reportCode}/working/image.png`, reportCode), null);
assert.equal(resolveReportAiSandboxArtifact(`sandbox:/app/workspace/data/1/${reportCode}/working/runtime/token.png`, reportCode), null);
assert.equal(resolveReportAiSandboxArtifact(`sandbox:/app/workspace/data/1/${reportCode}/working/.git/config`, reportCode), null);
assert.equal(resolveReportAiSandboxArtifact(`sandbox:/app/workspace/data/1/${reportCode}/working/private.key`, reportCode), null);

assert.equal(isAllowedReportAiArtifactPath("charts/daily-sales.svg"), true);
assert.equal(isAllowedReportAiArtifactPath("analysis.xlsx"), true);
assert.equal(isAllowedReportAiArtifactPath("../analysis.xlsx"), false);
assert.equal(isAllowedReportAiArtifactPath("runtime/analysis.xlsx"), false);

console.log("Report AI artifact contract passed");
