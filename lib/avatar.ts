/** Avatar URLs may be local assets or HTTPS images; never accept executable schemes. */
export function normalizeAvatar(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  const candidate = value.trim();
  if (candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\")) return candidate;
  try { const url = new URL(candidate); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
