// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { resolveShare } from "~/lib/fs";
import { createContentDisposition } from "~/lib/http";
import { streamObject } from "~/lib/r2";

export const Route = createFileRoute("/s/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const share = await resolveShare(params.token);
        if (!share || !share.r2Key) {
          return new Response("Share link not found", { status: 404 });
        }

        return streamObject(share.r2Key, {
          headers: {
            "cache-control": "private, max-age=60",
            "content-disposition": createContentDisposition("inline", share.name),
          },
        });
      },
    },
  },
});
