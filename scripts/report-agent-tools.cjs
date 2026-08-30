#!/usr/bin/env node

function usage() {
  console.log(`Usage:
  node scripts/report-agent-tools.cjs sources
  node scripts/report-agent-tools.cjs schema --data-source "业务主库" [--keyword "订单"] [--tables "table_a,table_b"] [--limit 20]
  node scripts/report-agent-tools.cjs preview-sql --data-source "业务主库" --sql "select 1" [--sql-file ./query.sql] [--params '{"foo":"bar"}'] [--max-rows 20]

Required env:
  REPORT_AGENT_TOOLS_BASE_URL
  REPORT_AGENT_TOOLS_REPORT_CODE
  REPORT_AGENT_TOOLS_TOKEN`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = "true";
    }
  }
  return options;
}

async function readSql(options) {
  if (options["sql-file"]) {
    const fs = await import("node:fs/promises");
    return (await fs.readFile(options["sql-file"], "utf8")).trim();
  }
  return typeof options.sql === "string" ? options.sql.trim() : "";
}

async function callTool(tool, args) {
  const baseUrl = (process.env.REPORT_AGENT_TOOLS_BASE_URL || "").replace(/\/+$/, "");
  const reportCode = (process.env.REPORT_AGENT_TOOLS_REPORT_CODE || "").trim();
  const token = (process.env.REPORT_AGENT_TOOLS_TOKEN || "").trim();

  if (!baseUrl || !reportCode || !token) {
    throw new Error("Missing REPORT_AGENT_TOOLS_BASE_URL / REPORT_AGENT_TOOLS_REPORT_CODE / REPORT_AGENT_TOOLS_TOKEN");
  }

  const response = await fetch(`${baseUrl}/api/reports/${encodeURIComponent(reportCode)}/agent-tools`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tool, args }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || `HTTP_${response.status}`);
    error.payload = result;
    throw error;
  }
  return result;
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "help" || command === "--help") {
    usage();
    process.exit(command ? 0 : 1);
  }

  const options = parseArgs(rest);

  if (command === "sources") {
    console.log(JSON.stringify(await callTool("list_data_sources", {}), null, 2));
    return;
  }

  if (command === "schema") {
    console.log(JSON.stringify(await callTool("get_data_source_schema", {
      dataSource: options["data-source"] || "",
      keyword: options.keyword || "",
      tables: typeof options.tables === "string" && options.tables.trim()
        ? options.tables.split(",").map((item) => item.trim()).filter(Boolean)
        : [],
      limit: options.limit ? Number(options.limit) : undefined,
    }), null, 2));
    return;
  }

  if (command === "preview-sql") {
    const sql = await readSql(options);
    let params = {};
    if (typeof options.params === "string" && options.params.trim()) {
      params = JSON.parse(options.params);
    }
    console.log(JSON.stringify(await callTool("preview_sql", {
      dataSource: options["data-source"] || "",
      sql,
      params,
      maxRows: options["max-rows"] ? Number(options["max-rows"]) : undefined,
    }), null, 2));
    return;
  }

  usage();
  process.exit(1);
}

main().catch((error) => {
  const payload = error && typeof error === "object" && "payload" in error ? error.payload : null;
  if (payload) {
    console.error(JSON.stringify(payload, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
});
