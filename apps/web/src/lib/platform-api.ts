import { z } from "zod";
import { pathSchema } from "@agfs/contracts";
import { requireRequestAuth } from "./authz";
import { json, parseJson, errorResponse } from "./http";
import * as workspaces from "./workspaces";
import * as search from "./search";
import * as runs from "./runs";
import * as drafts from "./drafts";
import * as webhooks from "./webhooks";
import * as budgets from "./budgets";
import { auditOperation } from "./request-context";
const name = z.string().trim().min(1).max(100),
  id = z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(128);
const permissions = z
  .array(z.enum(["read", "write", "delete", "share"]))
  .min(1)
  .max(4);
const limit = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
export async function platformApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url),
    prefix = "/api/v1/platform",
    path = url.pathname.slice(prefix.length),
    method = request.method;
  if (!url.pathname.startsWith(prefix + "/")) return null;
  const personal = [
    "/workspaces",
    "/workspaces/select",
    "/invites/accept",
    "/oauth/consent",
  ].includes(path);
  const auth = await requireRequestAuth(request, personal);
  const library = await (
    await import("./library-api")
  ).libraryApi(request, auth, path);
  if (library) return library;
  const saved = await (
    await import("./saved-searches-api")
  ).savedSearchesApi(request, auth, path);
  if (saved) return saved;
  const notes = await (
    await import("./file-notes-api")
  ).fileNotesApi(request, auth, path);
  if (notes) return notes;
  const extra = await (
    await import("./reliability-api")
  ).reliabilityApi(request, auth, path);
  if (extra) return extra;
  if (path === "/oauth/consent" && method === "POST") {
    const input = await parseJson(
      request,
      z.object({
        accept: z.boolean(),
        oauthQuery: z.string().max(10000),
        workspace: id.or(z.literal("personal")),
        path: pathSchema,
        permissions: z
          .array(z.enum(["read", "write", "delete", "share"]))
          .max(4),
      }),
    );
    return (await import("./oauth")).consentOAuth(request, auth, input);
  }
  if (path === "/workspaces") {
    if (method === "GET")
      return json({ workspaces: await workspaces.listWorkspaces(auth) });
    if (method === "POST")
      return json(
        await workspaces.createWorkspace(
          auth,
          (await parseJson(request, z.object({ name }))).name,
        ),
        { status: 201 },
      );
  }
  if (path === "/workspaces/select" && method === "POST") {
    if (auth.authSource !== "session")
      throw errorResponse(403, "Choose a workspace in the browser");
    const input = await parseJson(request, z.object({ workspace: id }));
    const headers = new Headers(request.headers);
    headers.set("x-agfs-workspace", input.workspace);
    await workspaces.selectNamespace(
      new Request(request.url, { headers }),
      auth,
    );
    return json(
      { ok: true },
      {
        headers: {
          "set-cookie": `agfs_workspace=${input.workspace}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${url.protocol === "https:" ? "; Secure" : ""}`,
        },
      },
    );
  }
  if (path === "/workspace" && method === "PATCH")
    return json(
      await workspaces.updateWorkspace(
        auth,
        await parseJson(
          request,
          z.object({
            name,
            paused: z.boolean(),
            storageLimit: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          }),
        ),
      ),
    );
  if (path === "/members") {
    if (method === "GET")
      return json({ members: await workspaces.members(auth) });
    if (method === "PATCH") {
      const v = await parseJson(
        request,
        z.object({ userId: id, role: z.enum(["editor", "viewer"]).nullable() }),
      );
      return json(await workspaces.updateMember(auth, v.userId, v.role));
    }
  }
  if (path === "/invites" && method === "POST") {
    const v = await parseJson(
      request,
      z.object({
        email: z.email().max(254),
        role: z.enum(["editor", "viewer"]),
        sendEmail: z.boolean().default(false),
      }),
    );
    const invite = await workspaces.inviteMember(auth, v.email, v.role);
    let emailSent = false,
      emailError: string | undefined;
    if (v.sendEmail) {
      try {
        await (
          await import("./workspace-admin")
        ).emailInvite(auth, v.email, invite.token);
        emailSent = true;
      } catch {
        emailError = "Email could not be sent; share the invitation link.";
      }
    }
    return json({ ...invite, emailSent, emailError }, { status: 201 });
  }
  if (path === "/invites/accept" && method === "POST")
    return json(
      await workspaces.acceptInvite(
        auth,
        (await parseJson(request, z.object({ token: id }))).token,
      ),
    );
  if (path === "/search" && method === "GET")
    return json(
      await search.searchFiles(
        auth,
        z
          .object({
            q: z.string().max(200).default(""),
            path: pathSchema.optional(),
            type: z.string().max(255).optional(),
            tag: z.string().max(40).optional(),
            cursor: z.string().max(4096).optional(),
            offset: z.coerce.number().int().min(0).max(100000).optional(),
          })
          .parse(Object.fromEntries(url.searchParams)),
      ),
    );
  if (path === "/tags" && method === "PUT") {
    const v = await parseJson(
      request,
      z.object({
        path: pathSchema,
        tags: z.array(z.string().trim().min(1).max(40)).max(20),
      }),
    );
    auditOperation("file.tag", v.path);
    return json(await search.tagFile(auth, v.path, v.tags));
  }
  if (path === "/runs") {
    if (method === "GET")
      return json(
        await runs.listRuns(auth, url.searchParams.get("cursor") ?? undefined),
      );
    if (method === "POST") {
      const v = await parseJson(
        request,
        z.object({
          name,
          path: pathSchema,
          metadata: z
            .record(z.string().max(80), z.string().max(1000))
            .default({}),
          retentionDays: z.number().int().min(1).max(90).default(30),
          inputs: z.array(pathSchema).max(50).default([]),
        }),
      );
      auditOperation("run.start", v.path);
      return json(await runs.createRun(auth, v), { status: 201 });
    }
  }
  const run = /^\/runs\/([\w-]+)(\/complete)?$/.exec(path);
  if (run) {
    if (!run[2] && method === "GET")
      return json(await runs.getRun(auth, run[1]));
    if (run[2] && method === "POST") {
      const r = await runs.getRun(auth, run[1]);
      auditOperation("run.complete", r.path_prefix);
      return json(await runs.finishRun(auth, run[1]));
    }
  }
  if (path === "/drafts") {
    if (method === "GET")
      return json(
        await drafts.listDrafts(
          auth,
          url.searchParams.get("cursor") ?? undefined,
        ),
      );
    if (method === "POST") {
      const v = await parseJson(request, z.object({ name, path: pathSchema }));
      auditOperation("draft.create", v.path);
      return json(await drafts.createDraft(auth, v.name, v.path), {
        status: 201,
      });
    }
  }
  const draft = /^\/drafts\/([\w-]+)(?:\/(changes|review|apply))?$/.exec(path);
  if (draft) {
    if (!draft[2] && method === "GET")
      return json(await drafts.draftDetail(auth, draft[1]));
    if (draft[2] === "changes" && method === "PUT") {
      const v = await parseJson(
        request,
        z.object({
          path: pathSchema,
          operation: z.enum(["write", "delete"]),
          content: z.string().max(8192).optional(),
          contentType: z.string().max(255).default("text/plain"),
        }),
      );
      auditOperation("draft.change", v.path);
      return json(await drafts.changeDraft(auth, draft[1], v));
    }
    if (draft[2] === "review" && method === "POST") {
      const v = await parseJson(request, z.object({ accept: z.boolean() }));
      return json(await drafts.reviewDraft(auth, draft[1], v.accept));
    }
    if (draft[2] === "apply" && method === "POST") {
      const d = await drafts.draft(auth, draft[1]);
      auditOperation("draft.apply", d.path_prefix);
      return json(await drafts.applyDraft(auth, draft[1]));
    }
  }
  if (path === "/webhooks") {
    if (method === "GET")
      return json({ webhooks: await webhooks.listWebhooks(auth) });
    if (method === "POST")
      return json(
        await webhooks.createWebhook(
          auth,
          await parseJson(
            request,
            z.object({
              url: z.url().max(2048),
              path: pathSchema,
              events: z
                .array(
                  z.enum([
                    "*",
                    "upload.commit",
                    "move",
                    "trash",
                    "mkdir",
                    "file.tag",
                    "run.start",
                    "run.complete",
                    "draft.apply",
                    "recovery.restore",
                  ]),
                )
                .min(1)
                .max(12),
            }),
          ),
        ),
        { status: 201 },
      );
  }
  const hook = /^\/webhooks\/([\w-]+)(\/deliveries)?$/.exec(path);
  if (hook) {
    if (hook[2] && method === "GET")
      return json({
        deliveries: await webhooks.webhookDeliveries(auth, hook[1]),
      });
    if (!hook[2] && method === "PATCH")
      return json(
        await webhooks.setWebhook(
          auth,
          hook[1],
          (await parseJson(request, z.object({ enabled: z.boolean() })))
            .enabled,
        ),
      );
  }
  const delivery = /^\/deliveries\/([\w-]+)\/retry$/.exec(path);
  if (delivery && method === "POST")
    return json(await webhooks.retryWebhook(auth, delivery[1]));
  if (path === "/budgets" && method === "GET")
    return json({
      agents: await budgets.listBudgets(auth),
      day: budgets.usageDay(),
    });
  const budget = /^\/budgets\/([\w-]+)$/.exec(path);
  if (budget && method === "PUT")
    return json(
      await budgets.updateBudget(
        auth,
        budget[1],
        await parseJson(
          request,
          z.object({
            paused: z.boolean(),
            storageLimit: limit,
            uploadLimit: limit,
            operationLimit: limit,
          }),
        ),
      ),
    );
  throw errorResponse(405, "Method or route not supported");
}
