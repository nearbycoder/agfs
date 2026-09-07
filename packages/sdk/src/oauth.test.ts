import { it, expect, vi } from "vitest";
import { OAuthSession, fileCredentialStore } from "./oauth";
import { mkdtemp, chmod, stat, symlink, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapConcurrent } from "./concurrency";
it("stores credentials privately and rejects an insecure directory or symlink", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agfs-oauth-")),
    file = join(dir, "credentials");
  const store = fileCredentialStore(file),
    value = {
      baseUrl: "https://agfs.dev",
      clientId: "client",
      tokenEndpoint: "https://agfs.dev/token",
      accessToken: "secret",
      expiresAt: 1,
    };
  try {
    await store.save(value);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await store.load()).toEqual(value);
    await store.clear();
    await symlink("/etc/passwd", file);
    await expect(store.load()).rejects.toThrow();
    await chmod(dir, 0o755);
    await expect(store.save(value)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("coalesces simultaneous refreshes and persists a rotated refresh token", async () => {
  const save = vi.fn(),
    fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        access_token: "new",
        refresh_token: "rotated",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );
  try {
    const session = new OAuthSession(
      {
        baseUrl: "https://agfs.dev",
        clientId: "client",
        tokenEndpoint: "https://agfs.dev/token",
        accessToken: "old",
        refreshToken: "refresh",
        expiresAt: 0,
      },
      { save, load: async () => null, clear: async () => {} },
    );
    expect(
      await Promise.all([session.token(), session.token(), session.token()]),
    ).toEqual(["new", "new", "new"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].refreshToken).toBe("rotated");
  } finally {
    fetcher.mockRestore();
  }
});
it("never sends a refresh token to another origin", () => {
  expect(
    () =>
      new OAuthSession({
        baseUrl: "https://agfs.dev",
        clientId: "client",
        tokenEndpoint: "https://evil.example/token",
        accessToken: "old",
        expiresAt: 0,
      }),
  ).toThrow();
});
it("bounds concurrency and waits for active work after a failure", async () => {
  let active = 0,
    max = 0,
    finished = 0;
  await expect(
    mapConcurrent([0, 1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      finished++;
      if (n === 1) throw new Error("stop");
      return n;
    }),
  ).rejects.toThrow("stop");
  expect(max).toBe(2);
  expect(active).toBe(0);
  expect(finished).toBeLessThan(6);
});
