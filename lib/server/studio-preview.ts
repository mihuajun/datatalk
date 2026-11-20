import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/server/mysql";
import { ensureConnectionSchema } from "@/lib/server/studio-connection-schema";
import { hashCredential, oauthGrantIdentity } from "@/lib/server/studio-oauth";
import { authenticateApiRequest, OpenApiError, type ApiPrincipal } from "@/lib/server/open-api-auth";
import { getReportDetailByCode } from "@/lib/server/report-repository";

export const previewCookieName = (code: string) => `studio-preview-${code}`;
export const PREVIEW_SESSION_SECONDS = 30 * 60;
type PreviewRow = RowDataPacket & { tenant_id: number; user_id: number; key_id: number; oauth_grant_id: string | null; report_code: string; ticket_expires_at: number; session_expires_at: number; session_hash: string | null };
export async function previewParentIdentity(row: Pick<PreviewRow, "tenant_id" | "user_id" | "key_id" | "oauth_grant_id">): Promise<ApiPrincipal | null> {
  let principal: ApiPrincipal | null = null;
  if (row.oauth_grant_id) principal = await oauthGrantIdentity(row.oauth_grant_id);
  else {
    const [keys] = await getDbPool().query<Array<RowDataPacket & { api_key: string }>>("SELECT api_key FROM studio_api_key WHERE id=? AND tenant_id=? AND user_id=?", [row.key_id, row.tenant_id, row.user_id]);
    if (keys[0]) try { principal = await authenticateApiRequest(new Request("http://localhost", { headers: { Authorization: `Bearer ${keys[0].api_key}` } })); } catch { return null; }
  }
  if (!principal || principal.tenantId !== Number(row.tenant_id) || principal.userId !== Number(row.user_id)) return null;
  return principal;
}
export async function createPreviewLink(principal: ApiPrincipal, reportCode: string, baseUrl: string) {
  await ensureConnectionSchema();
  if (!await getReportDetailByCode(principal.tenantId, reportCode)) throw new OpenApiError("REPORT_NOT_FOUND",404,"报表不存在");
  const ticket = randomBytes(32).toString("base64url");
  const expires = Date.now()+120000;
  await getDbPool().execute("INSERT INTO studio_preview_session (ticket_hash,tenant_id,user_id,key_id,oauth_grant_id,report_code,ticket_expires_at,session_expires_at) VALUES (?,?,?,?,?,?,?,?)", [hashCredential(ticket), principal.tenantId, principal.userId, principal.keyId, principal.oauthGrantId || null, reportCode, expires, 0]);
  return { previewUrl: `${baseUrl}/api/open/preview#ticket=${ticket}`, canonicalPreviewUrl: `${baseUrl}/preview/${reportCode}`, previewRequiresLogin: false, previewLinkExpiresAt: new Date(expires).toISOString(), previewSessionSeconds: PREVIEW_SESSION_SECONDS, previewInstructions: "立即在浏览器打开 previewUrl。此一次性链接 2 分钟内有效，兑换后可预览 30 分钟；过期或已打开时重新调用 inspect_report。不要公开分享此链接。" };
}
export async function redeemPreviewTicket(ticket: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new OpenApiError("PREVIEW_EXPIRED",401,"预览链接无效或已过期");
  await ensureConnectionSchema();
  const digest = hashCredential(ticket);
  const [rows] = await getDbPool().query<PreviewRow[]>("SELECT * FROM studio_preview_session WHERE ticket_hash=? AND session_hash IS NULL AND ticket_expires_at>?", [digest, Date.now()]);
  const row=rows[0];
  if (!row || !await previewParentIdentity(row)) throw new OpenApiError("PREVIEW_EXPIRED",401,"预览链接已过期或连接授权已取消，请从来源应用重新获取预览");
  const secret=randomBytes(32).toString("base64url");
  const [result] = await getDbPool().execute("UPDATE studio_preview_session SET session_hash=?,session_expires_at=? WHERE ticket_hash=? AND session_hash IS NULL AND ticket_expires_at>?", [hashCredential(secret), Date.now()+PREVIEW_SESSION_SECONDS*1000, digest, Date.now()]);
  if (!(result as { affectedRows:number }).affectedRows) throw new OpenApiError("PREVIEW_EXPIRED",401,"预览链接已被使用，请重新获取");
  return { secret, reportCode:row.report_code };
}
export async function getReportPreviewSession(reportCode: string): Promise<ApiPrincipal | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(reportCode)) return null;
  const secret=(await cookies()).get(previewCookieName(reportCode))?.value;
  if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  await ensureConnectionSchema();
  const [rows]=await getDbPool().query<PreviewRow[]>("SELECT * FROM studio_preview_session WHERE session_hash=? AND report_code=? AND session_expires_at>?", [hashCredential(secret), reportCode, Date.now()]);
  return rows[0] ? previewParentIdentity(rows[0]) : null;
}
