/** Browser-only operation transport and review guards. No background requests. */
export type OperationNamespace = { actor: string; workspace: string };
export type OperationRequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  mutation?: boolean;
};
export type OperationsClient = {
  namespace: OperationNamespace;
  request<T>(path: string, options?: OperationRequestOptions): Promise<T>;
};
type Fetcher = typeof fetch;
async function response<T>(
  fetcher: Fetcher,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetcher(path, init);
  let value: unknown;
  try {
    value = await res.json();
  } catch {
    throw new Error(
      `Request failed (${res.status}). The service returned an unreadable response.`,
    );
  }
  if (!res.ok) {
    const message =
      value &&
      typeof value === "object" &&
      "error" in value &&
      typeof value.error === "string"
        ? value.error
        : "Request failed";
    throw new Error(
      `${res.status === 401 || res.status === 403 ? "Access denied. Owner/manage permission is required. " : ""}${message}`,
    );
  }
  return value as T;
}
async function namespace(
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<OperationNamespace> {
  const value = await response<{
    user?: { id?: string };
    workspaceId?: string | null;
  }>(fetcher, "/api/v1/whoami", { signal });
  if (!value.user?.id)
    throw new Error("Could not identify the current account. Sign in again.");
  return { actor: value.user.id, workspace: value.workspaceId ?? "personal" };
}
export async function connectOperations(
  signal?: AbortSignal,
  onNamespaceChange?: () => void,
  fetcher: Fetcher = fetch,
): Promise<OperationsClient> {
  const selected = await namespace(fetcher, signal);
  return {
    namespace: selected,
    async request<T>(path: string, options: OperationRequestOptions = {}) {
      const { method = "GET", body, signal, mutation = false } = options;
      // Mutation confirmation is tied to both account and namespace. An explicit
      // header also pins the actual request if another tab changes the cookie.
      if (mutation) {
        const current = await namespace(fetcher, signal);
        if (
          current.actor !== selected.actor ||
          current.workspace !== selected.workspace
        ) {
          onNamespaceChange?.();
          throw new Error(
            "Account or workspace changed. Reconnect controls and preview again.",
          );
        }
      }
      return response<T>(fetcher, "/api/v1/platform" + path, {
        method,
        signal,
        headers: {
          "x-agfs-workspace": selected.workspace,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
  };
}
export function operationQuery(
  path: string,
  values: Record<string, string | number | boolean | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== "") query.set(key, String(value));
  return path + (query.size ? "?" + query : "");
}
export function operationInteger(
  raw: string,
  label: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}
export function nullableOperationLimit(raw: string, label: string) {
  return raw === "" ? null : operationInteger(raw, label);
}
export function metricWindow(hours: string, bucket: string) {
  const h = operationInteger(hours, "Hours", 1, 168),
    b = operationInteger(bucket, "Bucket minutes", 5, 60);
  if (![5, 15, 60].includes(b) || (h * 60) / b > 168)
    throw new Error(
      "Choose 5, 15, or 60-minute buckets and no more than 168 buckets. Use fewer hours or a larger bucket.",
    );
  return { hours: h, bucketMinutes: b as 5 | 15 | 60 };
}
export function selectedOperationIds(ids: string[], max: number) {
  if (
    !ids.length ||
    ids.length > max ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[\w-]{1,128}$/.test(id))
  )
    throw new Error(`Select 1–${max} distinct items from the loaded results.`);
  return [...ids];
}
export function createOperationReview<Q, T>() {
  let current: { scope: string; request: Q; value: T } | null = null;
  return {
    clear() {
      current = null;
    },
    stage(scope: string, request: Q, value: T) {
      current = { scope, request: structuredClone(request), value };
      return current;
    },
    consume(scope: string) {
      const value = current;
      current = null;
      if (!value || value.scope !== scope)
        throw new Error(
          "This preview is no longer current. Preview the selected scope again before applying.",
        );
      return value;
    },
  };
}
export type OperationPage<T> = { results: T[]; nextCursor: string | null };
export function appendOperationPage<T>(
  previous: OperationPage<T> | null,
  next: OperationPage<T>,
) {
  if ((previous?.results.length ?? 0) + next.results.length > 500)
    throw new Error(
      "This view holds at most 500 rows. Narrow the filters and load a fresh view.",
    );
  return { ...next, results: [...(previous?.results ?? []), ...next.results] };
}
export function operationTime(value: number | string | null | undefined) {
  if (value == null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unknown"
    : date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export type ReindexReviewRequest = {
  path: string;
  failedOnly: boolean;
  cursor?: string;
  reviewToken?: string;
  reviewExpiresAt?: number;
};
export function reviewedReindexRequest(
  request: ReindexReviewRequest,
  now = Date.now(),
) {
  if (
    !request.reviewToken ||
    !request.reviewExpiresAt ||
    request.reviewExpiresAt <= now
  )
    throw new Error(
      "This reindex review is missing or expired. Preview the page again before applying.",
    );
  return {
    path: request.path,
    failedOnly: request.failedOnly,
    ...(request.cursor ? { cursor: request.cursor } : {}),
    reviewToken: request.reviewToken,
    dryRun: false,
  };
}
