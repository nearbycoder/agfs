import { verifyTicket } from "./ticket";
interface Env {
  FILES_BUCKET: R2Bucket;
  PREVIEW_SIGNING_SECRET: string;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers({
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    });
    if (url.pathname !== "/view" || !["GET", "HEAD"].includes(request.method))
      return new Response("Not found", { status: 404, headers });
    const ticket = await verifyTicket(url.searchParams.get("ticket") ?? "", env.PREVIEW_SIGNING_SECRET);
    if (!ticket) return new Response("Preview expired. Open a new preview from AGFS.", { status: 403, headers });
    const object = await env.FILES_BUCKET.get(ticket.key);
    if (!object) return new Response("File not found", { status: 404, headers });
    headers.set("content-type", ticket.type);
    headers.set("content-length", String(object.size));
    headers.set(
      "content-disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(ticket.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    );
    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  },
};
