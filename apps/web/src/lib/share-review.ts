import { getEntryByPath } from "./fs";
import { requireResourceBindings } from "./bindings";
import { scanSecrets } from "./secret-scan";
import { errorResponse } from "./http";
import { authorize } from "./scope";
import type { RequestAuth } from "./authz";
export async function reviewShare(
  auth: RequestAuth,
  path: string,
  approvedEtag?: string,
) {
  authorize(auth, "share", path);
  const entry = await getEntryByPath(auth.user.id, path);
  if (!entry || entry.kind !== "file" || !entry.r2Key)
    throw errorResponse(404, "File not found");
  const text =
    /^(text\/|application\/(json|xml|javascript|x-yaml))/.test(
      entry.contentType ?? "",
    ) ||
    /\.(env|pem|key|txt|json|ya?ml|toml|ini|conf|sh|py|[cm]?js|ts)$/i.test(
      entry.name,
    );
  let findings: ReturnType<typeof scanSecrets> = [];
  if (text || (entry.size ?? 0) <= 1048576) {
    if ((entry.size ?? 0) > 1048576)
      throw errorResponse(
        409,
        "Text sharing review supports files up to 1 MiB",
      );
    const obj = await requireResourceBindings("FILES_BUCKET").FILES_BUCKET.get(
      entry.r2Key,
    );
    if (!obj) throw errorResponse(409, "File changed");
    findings = scanSecrets(await obj.text());
  }
  if (
    findings.length &&
    (auth.authSource !== "session" || approvedEtag !== entry.etag)
  )
    throw new Response(
      JSON.stringify({
        error:
          "Potential secrets detected. Review the file before approving public sharing.",
        code: "secret_review_required",
        etag: entry.etag,
        findings,
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  return entry.etag;
}
