export const API_SCOPES = ["reports:read", "reports:write", "datasources:read", "data:query"] as const;
export type ApiScope = typeof API_SCOPES[number];
export type ApiKeyView = {
  id: number; name: string; prefix: string; createdAt: string;
  lastUsedAt: string | null;
};
export type ApiLogView = { id: number; keyName: string; tool: string; reportCode: string | null; status: string; createdAt: string };
