import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, lstat, open, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
export interface OAuthCredentials {
  baseUrl: string;
  clientId: string;
  tokenEndpoint: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}
export interface CredentialStore {
  load(): Promise<OAuthCredentials | null>;
  save(value: OAuthCredentials): Promise<void>;
  clear(): Promise<void>;
}
/** Store in a user-owned private directory; tokens are never written to a project config. */
export function fileCredentialStore(file: string): CredentialStore {
  async function check() {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const dir = await lstat(dirname(file));
    if (
      !dir.isDirectory() ||
      dir.isSymbolicLink() ||
      dir.mode & 0o077 ||
      (process.getuid && dir.uid !== process.getuid())
    )
      throw new Error(
        "OAuth credential directory must be private and owned by you",
      );
  }
  return {
    async load() {
      await check();
      try {
        const f = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const s = await f.stat();
          if (
            !s.isFile() ||
            s.mode & 0o077 ||
            (process.getuid && s.uid !== process.getuid())
          )
            throw new Error("Unsafe credential file permissions");
          return JSON.parse(await f.readFile("utf8"));
        } finally {
          await f.close();
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async save(value) {
      await check();
      const tmp = file + "." + randomBytes(12).toString("hex");
      const f = await open(tmp, "wx", 0o600);
      try {
        await f.writeFile(JSON.stringify(value));
        await f.sync();
      } finally {
        await f.close();
      }
      try {
        await rename(tmp, file);
      } catch (e) {
        await unlink(tmp).catch(() => {});
        throw e;
      }
    },
    async clear() {
      await check();
      await unlink(file).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    },
  };
}
function origin(input: string) {
  const u = new URL(input);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
    )
  )
    throw new Error("Invalid OAuth server origin");
  return u.origin;
}
function endpoint(value: string, base: string) {
  const u = new URL(value);
  if (u.origin !== base || u.username || u.password || u.hash)
    throw new Error("OAuth endpoint must belong to the AGFS server");
  return u.href;
}
async function json(url: string, init: RequestInit = {}) {
  const r = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error("OAuth request failed (HTTP " + r.status + ")");
  }
  const text = await r.text();
  if (text.length > 131072) throw new Error("OAuth response too large");
  return JSON.parse(text);
}
function credentials(
  base: string,
  clientId: string,
  tokenEndpoint: string,
  t: any,
  previous?: OAuthCredentials,
): OAuthCredentials {
  if (
    typeof t.access_token !== "string" ||
    String(t.token_type).toLowerCase() !== "bearer" ||
    !Number.isFinite(t.expires_in) ||
    t.expires_in <= 0
  )
    throw new Error("Invalid OAuth token response");
  return {
    baseUrl: base,
    clientId,
    tokenEndpoint,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + t.expires_in * 1000,
  };
}
export class OAuthSession {
  private pending?: Promise<string>;
  constructor(
    private value: OAuthCredentials,
    private store?: CredentialStore,
  ) {
    const base = origin(value.baseUrl);
    endpoint(value.tokenEndpoint, base);
  }
  static async load(store: CredentialStore, baseUrl = "https://agfs.dev") {
    const value = await store.load();
    if (!value) return null;
    if (value.baseUrl !== origin(baseUrl))
      throw new Error("Credentials belong to another server");
    return new OAuthSession(value, store);
  }
  token = async (): Promise<string> => {
    if (this.value.expiresAt > Date.now() + 60000)
      return this.value.accessToken;
    return (this.pending ??= (async () => {
      try {
        if (!this.value.refreshToken) throw new Error("Sign in again to AGFS");
        const t = await json(this.value.tokenEndpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: this.value.clientId,
            refresh_token: this.value.refreshToken,
            resource: this.value.baseUrl + "/mcp",
          }),
        });
        this.value = credentials(
          this.value.baseUrl,
          this.value.clientId,
          this.value.tokenEndpoint,
          t,
          this.value,
        );
        await this.store?.save(this.value);
        return this.value.accessToken;
      } finally {
        this.pending = undefined;
      }
    })());
  };
  static async login(options: {
    baseUrl?: string;
    scopes?: string[];
    store?: CredentialStore;
    onAuthorizationUrl: (url: string) => void | Promise<void>;
    signal?: AbortSignal;
  }): Promise<OAuthSession> {
    const base = origin(options.baseUrl ?? "https://agfs.dev"),
      metadata = await json(
        base + "/.well-known/oauth-authorization-server/api/auth",
      );
    if (metadata.issuer !== base + "/api/auth")
      throw new Error("Unexpected OAuth issuer");
    const authorize = endpoint(metadata.authorization_endpoint, base),
      tokenEndpoint = endpoint(metadata.token_endpoint, base),
      registration = endpoint(metadata.registration_endpoint, base);
    const verifier = randomBytes(32).toString("base64url"),
      state = randomBytes(32).toString("base64url");
    let receive!: (v: string) => void, fail!: (e: Error) => void;
    const code = new Promise<string>((resolve, reject) => {
      receive = resolve;
      fail = reject;
    });
    void code.catch(() => {});
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400).end("Invalid authorization state");
        return;
      }
      if (
        url.searchParams.has("iss") &&
        url.searchParams.get("iss") !== metadata.issuer
      ) {
        res.writeHead(400).end("Invalid issuer");
        fail(new Error("Invalid OAuth issuer"));
        return;
      }
      const value = url.searchParams.get("code");
      res
        .writeHead(value ? 200 : 400, {
          "content-type": "text/plain",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'",
        })
        .end(
          value
            ? "Signed in. You can close this tab."
            : "Authorization declined.",
        );
      if (value) receive(value);
      else fail(new Error("Authorization declined"));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const abort = () => fail(new Error("OAuth login cancelled"));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => fail(new Error("OAuth login timed out")),
      300000,
    );
    try {
      if (options.signal?.aborted) throw new Error("OAuth login cancelled");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No OAuth callback listener");
      const redirect = "http://127.0.0.1:" + address.port + "/callback";
      const client = await json(registration, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "AGFS TypeScript SDK",
          application_type: "native",
          redirect_uris: [redirect],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          scope: (
            options.scopes ?? [
              "openid",
              "offline_access",
              "agfs:read",
              "agfs:write",
            ]
          ).join(" "),
        }),
      });
      if (typeof client.client_id !== "string")
        throw new Error("Invalid client registration");
      const u = new URL(authorize);
      u.search = new URLSearchParams({
        client_id: client.client_id,
        response_type: "code",
        redirect_uri: redirect,
        state,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        resource: base + "/mcp",
        scope: (
          options.scopes ?? [
            "openid",
            "offline_access",
            "agfs:read",
            "agfs:write",
          ]
        ).join(" "),
      }).toString();
      await options.onAuthorizationUrl(u.href);
      const t = await json(tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          code: await code,
          redirect_uri: redirect,
          code_verifier: verifier,
          resource: base + "/mcp",
        }),
      });
      const value = credentials(base, client.client_id, tokenEndpoint, t);
      await options.store?.save(value);
      return new OAuthSession(value, options.store);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      server.closeAllConnections();
      server.close();
    }
  }
}
