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

          if (!upload) {
            return new Response("Upload not found", { status: 404 });
          }

          if (upload.expiresAt.getTime() <= Date.now()) {
            return new Response("Upload expired", { status: 410 });
          }
          const uploadToken = request.headers.get("x-agfs-upload-token");
          if (!uploadToken || !verifyHash(uploadToken, upload.uploadTokenHash)) {
            return new Response("Upload not found", { status: 404 });
          }

          const body = request.body ?? (await request.arrayBuffer());
          const result = await putObject(upload.objectKey, body, upload.contentType);
          const headers = new Headers();
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
