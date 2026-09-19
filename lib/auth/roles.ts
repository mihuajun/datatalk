export type UserRole = "administrator" | "admin" | "developer";

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  administrator: "超级管理员",
  admin: "租户管理员",
  developer: "开发者",
};

export function normalizeUserRole(value: unknown): UserRole {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["administrator", "adminstrator", "super_admin", "superadmin", "超级管理员"].includes(normalized)) return "administrator";
  if (["admin", "管理员", "租户管理员"].includes(normalized)) return "admin";
  return "developer";
}

export function getUserRoleLabel(role: UserRole) {
  return USER_ROLE_LABELS[role];
}

export function isAdminRole(role: UserRole) {
  return role === "administrator" || role === "admin";
}

export function isAdministratorRole(role: UserRole) {
  return role === "administrator";
}

export function canAccessMembersRole(role: UserRole) {
  return role === "administrator" || role === "admin";
}

export function canManageMembersRole(role: UserRole) {
  return role === "administrator" || role === "admin";
}
