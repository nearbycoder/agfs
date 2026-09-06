// @ts-nocheck
import { and, eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { verifyHash } from "@agfs/db";
import { uploads } from "@agfs/db";
import { db } from "~/lib/db";
import { handleRouteError } from "~/lib/http";
import { putObject } from "~/lib/r2";

export const Route = createFileRoute("/api/v1/fs/uploads/$id/blob")({
  server: {
    handlers: {
      PUT: async ({ params, request }) => {
        try {
          const [upload] = await db
            .select()
            .from(uploads)
            .where(and(eq(uploads.id, params.id), eq(uploads.status, "pending")));

          if (!upload || upload.multipartId || upload.size > 100_000_000) {
            return new Response("Upload not found", { status: 404 });
          }

          if (upload.expiresAt.getTime() <= Date.now()) {
            return new Response("Upload expired", { status: 410 });
          }
          const uploadToken = request.headers.get("x-agfs-upload-token");
          if (!uploadToken || !verifyHash(uploadToken, upload.uploadTokenHash)) {
            return new Response("Upload not found", { status: 404 });
          }

          const contentLength = request.headers.get("content-length");
          if (contentLength === null || !/^\d+$/.test(contentLength) || Number(contentLength) !== upload.size) {
            return new Response("Content-Length must match upload intent", { status: 400 });
          }
          const body = request.body ?? (await request.arrayBuffer());
          const result = await putObject(upload.objectKey, body, upload.contentType);
          if (!result) return new Response("Upload already received", { status: 409 });
          const headers = new Headers({ "cache-control": "no-store" });
          if (result.etag) {
            headers.set("etag", result.etag);
          }

          return new Response(null, {
            status: 200,
            headers,
          });
        } catch (error) {
          return handleRouteError(error);
        }
      },
    },
  },
});
