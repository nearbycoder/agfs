/**
 * The Container SDK counts a proxied request as active until its response body
 * is consumed. Keep that consumption inside the Durable Object, then stop the
 * short-lived metadata process when the last concurrent request finishes.
 */
export class MetadataRequestLifecycle {
  private activeRequests = 0;
  private stopping: Promise<void> | undefined;
  private readonly forward: (request: Request) => Promise<Response>;
  private readonly stop: () => Promise<void>;

  constructor(
    forward: (request: Request) => Promise<Response>,
    stop: () => Promise<void>,
  ) {
    this.forward = forward;
    this.stop = stop;
  }

  async fetch(request: Request): Promise<Response> {
    if (this.stopping) await this.stopping;
    this.activeRequests++;
    try {
      const upstream = await this.forward(request);
      // The metadata server caps bodies at 128 KiB. Reading here also lets the
      // SDK release its inflight counter even if the caller ignores the body.
      const body = await upstream.arrayBuffer();
      const noBody =
        request.method === "HEAD" || [204, 205, 304].includes(upstream.status);
      return new Response(noBody ? null : body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
      });
    } finally {
      this.activeRequests--;
      if (this.activeRequests === 0) {
        const stopping = Promise.resolve().then(() => this.stop());
        this.stopping = stopping;
        try {
          await stopping;
        } finally {
          if (this.stopping === stopping) this.stopping = undefined;
        }
      }
    }
  }
}
