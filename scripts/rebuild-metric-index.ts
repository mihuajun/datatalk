import { ensureDatabaseBootstrap } from "../lib/server/database-bootstrap";
import { rebuildMetricSearchIndex } from "../lib/server/metric-retrieval";
import { getDbPool } from "../lib/server/mysql";
async function main() {
  const tenantId = Number(process.argv[2]);
  if (!Number.isSafeInteger(tenantId) || tenantId < 1) throw new Error("Usage: tsx scripts/rebuild-metric-index.ts <tenantId>");
  try { await ensureDatabaseBootstrap(); console.log(JSON.stringify(await rebuildMetricSearchIndex(tenantId))); }
  finally { await getDbPool().end(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
