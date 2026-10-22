import { it, expect, vi, beforeEach } from "vitest";
const { rows, index, deliver, sendBatch } = vi.hoisted(() => ({
  rows: vi.fn(),
  index: vi.fn(),
  deliver: vi.fn(),
  sendBatch: vi.fn(),
}));
vi.mock("./platform-db", () => ({ rows }));
vi.mock("./search", () => ({ indexFiles: index }));
vi.mock("./webhooks", () => ({ deliverWebhooks: deliver }));
vi.mock("./bindings", () => ({
  getBindings: () => ({ BACKGROUND_QUEUE: { sendBatch } }),
}));
import { consumeBackground } from "./background";
beforeEach(() => {
  vi.clearAllMocks();
  rows.mockResolvedValue([]);
  index.mockResolvedValue(1);
  deliver.mockResolvedValue(1);
  sendBatch.mockResolvedValue(undefined);
});
it("acknowledges successful index work and retries processing failures", async () => {
  const ack = vi.fn(),
    retry = vi.fn();
  await consumeBackground({
    queue: "agfs-background",
    messages: [{ body: { id: "entry", kind: "index" }, ack, retry }],
  });
  expect(index).toHaveBeenCalledWith(1, "entry", undefined);
  expect(ack).toHaveBeenCalledTimes(1);
  index.mockRejectedValue(new Error("storage"));
  await consumeBackground({
    queue: "agfs-background",
    messages: [{ body: { id: "entry", kind: "index" }, ack, retry }],
  });
  expect(retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  expect(ack).toHaveBeenCalledTimes(1);
});
it("records dead letters without attempting an external webhook delivery", async () => {
  const ack = vi.fn();
  await consumeBackground({
    queue: "agfs-background-dead",
    messages: [
      { body: { id: "delivery", kind: "webhook" }, ack, retry: vi.fn() },
    ],
  });
  expect(deliver).not.toHaveBeenCalled();
  expect(rows).toHaveBeenCalledTimes(1);
  expect(ack).toHaveBeenCalledOnce();
});
it("ignores a stale generation before touching source work", async () => {
  const ack = vi.fn();
  await consumeBackground({queue:"agfs-background-dead",messages:[{body:{id:"entry",kind:"index",generation:1},ack,retry:vi.fn()}]} as any);
  expect(index).not.toHaveBeenCalled(); expect(deliver).not.toHaveBeenCalled();
  expect(rows).toHaveBeenCalledOnce(); expect(ack).toHaveBeenCalledOnce();
});
