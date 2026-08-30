export type UserRole = "admin" | "developer";

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  developer: "开发者",
};

export function normalizeUserRole(value: unknown): UserRole {
  if (value === "admin" || value === "管理员") return "admin";
  return "developer";
}

export function getUserRoleLabel(role: UserRole) {
  return USER_ROLE_LABELS[role];
}

export function isAdminRole(role: UserRole) {
  return role === "admin";
}
