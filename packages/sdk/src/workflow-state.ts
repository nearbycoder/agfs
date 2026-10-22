import type { AgfsClient } from "./index.js";

export interface WorkflowResource { kind?: "draft" | "run"; resourceId: string; completed: number }
export class WorkflowError extends Error {
  constructor(message: string, public resourceId: string, public completed: number, cause: unknown, public resources?: WorkflowResource[]) {
    super(message, { cause }); this.name = "WorkflowError";
  }
}
interface Journal { open: boolean; records: Set<WorkflowResource>; parent?: Journal }
const scopes = new WeakMap<AgfsClient, Journal>();

// Internal scope state. Only acknowledged IDs and acknowledged changes enter it.
// Each new resource consumes a transport attempt; retained state is bounded by
// the enclosing request budget. A scope never waits for user work to settle.
export function openWorkflowScope(client: AgfsClient, parent: AgfsClient) {
  const journal: Journal = { open: true, records: new Set(), parent: scopes.get(parent) };
  scopes.set(client, journal);
  return {
    failure(cause: unknown): unknown {
      const resources = [...journal.records].map(record => ({ ...record }));
      if (!resources.length) return cause;
      if (cause instanceof WorkflowError && resources.length === 1 && resources[0].resourceId === cause.resourceId) return cause;
      const first = resources[0];
      return new WorkflowError("Operation stopped with incomplete workflows; inspect the confirmed resources before retrying", first.resourceId, first.completed, cause, resources);
    },
    close() { journal.open = false; journal.records.clear(); scopes.delete(client); },
  };
}
export function beginWorkflow(client: AgfsClient, kind: "draft" | "run", resourceId: string) {
  const record: WorkflowResource = { kind, resourceId, completed: 0 }, journals: Journal[] = [];
  for (let journal = scopes.get(client); journal; journal = journal.parent) if (journal.open) { journal.records.add(record); journals.push(journal); }
  return {
    confirmed() { if (journals.some(journal => journal.open)) record.completed++; },
    succeeded() { for (const journal of journals) journal.records.delete(record); },
  };
}
