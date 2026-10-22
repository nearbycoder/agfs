import * as contracts from "@agfs/contracts";
import type { RequestAuth } from "./authz";
import { authorize } from "./scope";
import { json, parseJson } from "./http";
import * as resources from "./resource-controls";
import * as budgets from "./resource-controls-budgets";
import * as uploads from "./resource-controls-uploads";
import * as health from "./resource-controls-health";
import * as retention from "./resource-controls-retention";
import { auditOperation } from "./request-context";

export async function resourceControlsApi(request: Request, auth: RequestAuth, route: string): Promise<Response | null> {
  authorize(auth, "manage");
  const path = route.slice("/operations".length), method = request.method,
    query = Object.fromEntries(new URL(request.url).searchParams);
  const result = async () => {
    if (path === "/search-policy") {
      if (method === "GET") return resources.indexingPolicy(auth);
      if (method === "PUT") return resources.indexingPolicy(auth, await parseJson(request, contracts.indexingPolicySchema));
    }
    if (path === "/index" && ["GET", "POST"].includes(method)) return resources.indexDiagnostics(auth,
      method === "GET" ? contracts.indexDiagnosticsSchema.parse(query) : await parseJson(request, contracts.indexDiagnosticsSchema));
    if (path === "/reindex" && method === "POST") return resources.reindexPlan(auth, await parseJson(request, contracts.reindexPlanSchema));
    if (path === "/background") {
      if (method === "GET") return resources.backgroundPolicy(auth);
      if (method === "PUT") return resources.backgroundPolicy(auth, await parseJson(request, contracts.backgroundPolicySchema));
    }
    if (path === "/failures" && method === "GET") return resources.queueFailures(auth, contracts.operationsPageSchema.parse(query).cursor);
    if (path === "/failures/retry" && method === "POST") return resources.retryFailures(auth, (await parseJson(request, contracts.failureRetrySchema)).ids);
    if (path === "/maintenance" && method === "GET") return resources.maintenanceStatus(auth);
    if (path === "/uploads" && ["GET", "POST"].includes(method)) return uploads.uploadInventory(auth,
      method === "GET" ? contracts.uploadInventorySchema.parse(query) : await parseJson(request, contracts.uploadInventorySchema));
    if (path === "/uploads/abandon" && method === "POST") {
      const v = await parseJson(request, contracts.abandonUploadsSchema); return uploads.abandonUploads(auth, v.ids, v.dryRun);
    }
    if (path === "/budgets/history" && method === "GET") {
      const v = contracts.budgetHistorySchema.parse(query); return budgets.budgetHistory(auth, v.tokenId, v.days);
    }
    if (path === "/budgets/tokens" && method === "GET") return budgets.budgetTokens(auth, contracts.budgetTokensSchema.parse(query).cursor);
    if (path === "/budgets/preflight" && method === "POST") return budgets.budgetPreflight(auth, await parseJson(request, contracts.budgetPreflightSchema));
    if (path === "/budgets/batch" && method === "PUT") return budgets.batchBudgets(auth, (await parseJson(request, contracts.budgetBatchSchema)).updates);
    if (path === "/metrics" && method === "GET") return health.operationSeries(auth, contracts.operationMetricsSchema.parse(query));
    const alert = /^\/alerts\/([\w-]{1,128})\/(acknowledge|snooze)$/.exec(path);
    if (alert) {
      if (alert[2] === "acknowledge" && method === "DELETE") return health.acknowledgeAlert(auth, alert[1], null);
      if (alert[2] === "acknowledge" && method === "PUT") return health.acknowledgeAlert(auth, alert[1], (await parseJson(request, contracts.alertAcknowledgementSchema)).note);
      if (alert[2] === "snooze" && method === "PUT") return health.snoozeAlert(auth, alert[1], (await parseJson(request, contracts.alertSnoozeSchema)).minutes);
    }
    if (path === "/retention/references" && ["GET", "POST"].includes(method)) return retention.retentionReferences(auth,
      method === "GET" ? contracts.retentionReferencesSchema.parse(query) : await parseJson(request, contracts.retentionReferencesSchema));
    if (path === "/retention/expiring" && method === "GET") return retention.retentionExpiring(auth, contracts.retentionExpirySchema.parse(query));
    if (path === "/webhooks/cleanup" && method === "POST") {
      const v = await parseJson(request, contracts.webhookCleanupSchema); return retention.cleanupWebhookHistory(auth, v.ids, v.dryRun);
    }
    return null;
  };
  const output = await result();
  if (output !== null && !["GET", "HEAD"].includes(method) && !("dryRun" in output && output.dryRun) && !["/budgets/preflight", "/index", "/uploads", "/retention/references"].includes(path))
    auditOperation("operations" + path);
  if (output === null) return null;
  const response = json(output);
  response.headers.set("cache-control", "private, no-store");
  return response;
}
