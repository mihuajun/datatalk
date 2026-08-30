const reportAiWorkspaceQueues = new Map<string, Promise<void>>();

export async function withReportAiWorkspaceCommitLock<T>(tenantId: number, reportCode: string, task: () => Promise<T>) {
  const key = `${tenantId}:${reportCode}`;
  const previous = reportAiWorkspaceQueues.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  reportAiWorkspaceQueues.set(key, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (reportAiWorkspaceQueues.get(key) === current) reportAiWorkspaceQueues.delete(key);
  }
}
