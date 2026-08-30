export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const instrumentationModule = await import("./instrumentation.node");
  await instrumentationModule.register();
}
