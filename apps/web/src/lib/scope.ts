import { normalizeAgfsPath } from "@agfs/db";
import type { RequestAuth } from "./authz";
import { errorResponse } from "./http";

export type Permission = "read" | "write" | "delete" | "share" | "manage";
export const ALL_PERMISSIONS: Permission[] = [
  "read",
  "write",
  "delete",
  "share",
  "manage",
];
export function withinPath(path: string, prefix: string) {
  path = normalizeAgfsPath(path);
  prefix = normalizeAgfsPath(prefix);
  return prefix === "/" || path === prefix || path.startsWith(`${prefix}/`);
}
export function canAccess(
  auth: RequestAuth,
  permission: Permission,
  path = "/",
) {
  const permissions =
    auth.permissions ?? (auth.authSource === "session" ? ALL_PERMISSIONS : []);
  if (auth.workspacePaused && ["write", "delete", "share"].includes(permission))
    return false;
  return (
    permissions.includes(permission) && withinPath(path, auth.pathPrefix ?? "/")
  );
}
export function authorize(
  auth: RequestAuth,
  permission: Permission,
  ...paths: string[]
) {
  if (
    !(paths.length ? paths : ["/"]).every((path) =>
      canAccess(auth, permission, path),
    )
  ) {
    throw errorResponse(403, "Token does not permit this operation or path");
  }
}
