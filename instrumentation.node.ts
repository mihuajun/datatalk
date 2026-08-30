import { getAgentRuntimeStatus, prepareManagedAgentRuntimeHome, startAgentRuntime, stopAgentRuntime } from "@/lib/server/agent-runtime";
import { ensureDatabaseBootstrap } from "@/lib/server/database-bootstrap";

let lifecycleRegistered = false;
let shutdownStarted = false;

async function startManagedAgentRuntime() {
  try {
    prepareManagedAgentRuntimeHome();
    const status = await getAgentRuntimeStatus();
    if (!status.installed) {
      console.warn("Agent Runtime 未安装，跳过自动启动");
      return;
    }

    await startAgentRuntime();
    console.info("Agent Runtime 已随 chat-bi 自动启动");
  } catch (error) {
    console.error("自动启动 Agent Runtime 失败", error);
  }
}

async function shutdownManagedAgentRuntime(signal: string) {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;

  try {
    await stopAgentRuntime();
    console.info(`Agent Runtime 已随 chat-bi 停止 (${signal})`);
  } catch (error) {
    console.error("随 chat-bi 停止 Agent Runtime 失败", error);
  } finally {
    process.exit(0);
  }
}

export async function register() {
  if (lifecycleRegistered) {
    return;
  }
  lifecycleRegistered = true;

  process.once("SIGTERM", () => {
    void shutdownManagedAgentRuntime("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdownManagedAgentRuntime("SIGINT");
  });

  await ensureDatabaseBootstrap();
  console.info("应用数据库初始化检查完成");
  await startManagedAgentRuntime();
}
