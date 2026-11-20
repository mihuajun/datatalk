import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const root = process.cwd();
const local = path.join(root, ".workbuddy-local");
const configPath = path.join(local, "workbuddy.mcp.credentials.json");
const acceptance = JSON.parse(await fs.readFile(path.join(local, "acceptance.json"), "utf8"));
const cli = process.env.WORKBUDDY_CLI_PATH || "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy";
await fs.access(cli); await fs.access(configPath);
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const serverNames = Object.keys(config.mcpServers || {});
if (serverNames.length !== 1) throw new Error("The verification config must contain exactly one Studio MCP server.");
const serverName = serverNames[0];
const toolPrefix = `mcp__${serverName}__`;
const args = [cli, "--print", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--strict-mcp-config", "--mcp-config", configPath, "--tools", "", "--allowedTools",
  `${toolPrefix}get_studio_context`, `${toolPrefix}list_data_sources`, `${toolPrefix}preview_query`, "--max-turns", "8",
  `验证 DataTalk Studio MCP 连接。必须调用 get_studio_context 和 list_data_sources，再用 preview_query 对数据源 ${acceptance.sourceName} 执行 SELECT SUM(amount) AS revenue FROM orders WHERE status='paid'。回答当前租户、收入和数据源名。只使用这三个 MCP 工具，不读取本地文件，不使用其他工具。`];
const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, CODEBUDDY_FORCE_LITE_WB_BUNDLE: "1", CODEBUDDY_CONFIG_DIR: path.join(os.homedir(), ".workbuddy") }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", chunk => { output += chunk.toString(); });
child.stderr.on("data", chunk => { output += chunk.toString(); });
const timeout = setTimeout(() => child.kill("SIGTERM"), 180000);
const exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
clearTimeout(timeout);
const summary = { connected: false, tools: [], calledTools: [], modelLoginRequired: /Authentication required|Please use \/login/i.test(output), exitCode, result: "" };
for (const line of output.split(/\r?\n/)) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  if (event.type === "system" && event.subtype === "init") {
    summary.connected ||= event.mcp_servers?.some(server => server.name === serverName && server.status === "connected");
    summary.tools = event.tools?.filter(name => name.startsWith(toolPrefix)) || [];
  }
  if (event.type === "assistant") for (const content of event.message?.content || []) if (content.type === "tool_use") summary.calledTools.push(content.name);
  if (event.type === "result" && event.subtype === "success") summary.result = event.result || "";
}
// Never emit raw client logs; they can contain authentication or configuration details.
await fs.writeFile(path.join(local, "workbuddy-verification.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.connected && summary.calledTools.includes(`${toolPrefix}preview_query`) && summary.result.includes("2000") ? 0 : summary.modelLoginRequired ? 2 : 1;
