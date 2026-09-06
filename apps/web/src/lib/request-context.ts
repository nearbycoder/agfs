import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestAuth } from "./authz";
export const requestContext = new AsyncLocalStorage<{ auth?: RequestAuth; action?: string; path?: string }>();
export function auditOperation(action: string, path?: string) {
  const context = requestContext.getStore();
  if (context) {
    context.action = action;
    context.path = path;
  }
}
