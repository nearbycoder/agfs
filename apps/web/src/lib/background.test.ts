import { it, expect, vi, beforeEach } from "vitest";
const { rows, index, deliver, send } = vi.hoisted(() => ({
  rows: vi.fn(),
  index: vi.fn(),
  deliver: vi.fn(),
  send: vi.fn(),
}));
vi.mock("./platform-db", () => ({ rows }));
vi.mock("./search", () => ({ indexFiles: index }));
vi.mock("./webhooks", () => ({ deliverWebhooks: deliver }));
vi.mock("./bindings", () => ({
  getBindings: () => ({ BACKGROUND_QUEUE: { send } }),
}));
import { consumeBackground, dispatchBackground } from "./background";
beforeEach(() => {
  vi.clearAllMocks();
  rows.mockResolvedValue([]);
  index.mockResolvedValue(1);
  deliver.mockResolvedValue(1);
  send.mockResolvedValue(undefined);
});
it("acknowledges successful index work and retries processing failures", async () => {
  const ack = vi.fn(),
    retry = vi.fn();
  await consumeBackground({
    queue: "agfs-background",
    messages: [{ body: { id: "entry", kind: "index" }, ack, retry }],
  });
  expect(index).toHaveBeenCalledWith(1, "entry");
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
  expect(rows).toHaveBeenCalledTimes(3);
  expect(ack).toHaveBeenCalledOnce();
});
it("leaves an outbox item undispatched when queue send fails", async () => {
  rows
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "entry", kind: "index" }]);
  send.mockRejectedValue(new Error("queue unavailable"));
  await expect(dispatchBackground()).rejects.toThrow();
  expect(rows).toHaveBeenCalledTimes(3);
});
