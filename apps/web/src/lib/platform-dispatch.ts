import type { RequestAuth } from "./authz";

type Handler = (request: Request, auth: RequestAuth, path: string) => Promise<Response | null>;
type Loader = () => Promise<Handler>;

// Match before importing: unrelated handlers must not enter the cold request path.
// Modules are code only; authentication and authorization still run on every request.
const extensions: Array<[RegExp, Loader]> = [
  [/^\/batch-rename$/, async () => (await import("./batch-rename-api")).batchRenameApi],
  [/^\/recent-files$/, async () => (await import("./recent-files")).recentFilesApi],
  [/^\/favorites$/, async () => (await import("./library-api")).libraryApi],
  [/^\/saved-searches(?:\/[\w-]+)?$/, async () => (await import("./saved-searches-api")).savedSearchesApi],
  [/^\/notes$/, async () => (await import("./file-notes-api")).fileNotesApi],
  [/^\/collections(?:\/[\w-]+(?:\/items)?)?$/, async () => (await import("./collections-api")).collectionsApi],
  [/^\/storage\/insights$/, async () => (await import("./storage-insights-api")).storageInsightsApi],
  [/^\/storage\/duplicates$/, async () => (await import("./duplicates-api")).duplicatesApi],
  [/^\/text$/, async () => (await import("./text-files-api")).textFilesApi],
  [/^\/templates(?:\/[\w-]+)?$/, async () => (await import("./templates-api")).templatesApi],
  [/^\/(?:changes|snapshots(?:\/[\w-]+(?:\/(?:restore|manifest|file))?)?|runs\/[\w-]+\/file|health(?:\/thresholds)?|search\/reindex|(?:tokens|webhooks)\/[\w-]+\/rotate|invites(?:\/[\w-]+)?|ownership(?:\/accept)?|review-policy|drafts\/[\w-]+\/(?:comments|request-changes|resubmit))$/, async () => (await import("./reliability-api")).reliabilityApi],
];

export async function dispatchPlatformExtension(request: Request, auth: RequestAuth, path: string) {
  const extension = extensions.find(([pattern]) => pattern.test(path));
  return extension ? (await extension[1]())(request, auth, path) : null;
}
