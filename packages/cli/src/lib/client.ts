import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { lookup as lookupMime } from "mime-types";
import {
  accountSummarySchema,
  devicePollResponseSchema,
  deviceStartResponseSchema,
  listEntriesResponseSchema,
  shareCreateResponseSchema,
  shareListResponseSchema,
  successResponseSchema,
  tokenCreateResponseSchema,
  tokenListResponseSchema,
  treeEntriesResponseSchema,
  uploadIntentSchema,
  whoAmIResponseSchema,
} from "@agfs/contracts";
import { getResolvedBaseUrl, getResolvedToken, readConfig } from "./config";
import { flattenTree, getRemoteLeafName, joinRelativeDestination, resolveFileDestination, resolveFolderDestination } from "./download";
import { summarizeFolderDownload, TransferProgress } from "./progress";

async function parseError(response: Response) {
  try {
    const payload = await response.json();
    return payload.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

export class AgfsClient {
  constructor(
    readonly baseUrl: string,
    readonly token: string | null,
  ) {}

  static async fromConfig() {
    const config = await readConfig();
    return new AgfsClient(getResolvedBaseUrl(config), getResolvedToken(config));
  }

  private async request(pathname: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (this.token) {
      headers.set("authorization", `Bearer ${this.token}`);
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      throw new Error(await parseError(response));
    }

    return response;
  }

  async whoAmI() {
    const response = await this.request("/api/v1/whoami");
    return whoAmIResponseSchema.parse(await response.json());
  }

  async account() {
    const response = await this.request("/api/v1/account");
    return accountSummarySchema.parse(await response.json());
  }

  async startDeviceLogin(clientName = "agfs cli") {
    const response = await this.request("/api/v1/device/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientName }),
    });
    return deviceStartResponseSchema.parse(await response.json());
  }

  async pollDeviceLogin(deviceCode: string) {
    const response = await this.request("/api/v1/device/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });
    return devicePollResponseSchema.parse(await response.json());
  }

  async list(pathname: string) {
    const response = await this.request(`/api/v1/fs/list?path=${encodeURIComponent(pathname)}`);
    return listEntriesResponseSchema.parse(await response.json());
  }

  async tree(pathname: string) {
    const response = await this.request(`/api/v1/fs/tree?path=${encodeURIComponent(pathname)}`);
    return treeEntriesResponseSchema.parse(await response.json());
  }

  async mkdir(pathname: string) {
    const response = await this.request("/api/v1/fs/mkdir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathname }),
    });
    return successResponseSchema.parse(await response.json());
  }

  async move(from: string, to: string) {
    const response = await this.request("/api/v1/fs/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    });
    return successResponseSchema.parse(await response.json());
  }

  async remove(pathname: string, recursive = false) {
    const response = await this.request("/api/v1/fs/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathname, recursive }),
    });
    return successResponseSchema.parse(await response.json());
  }

  async upload(localPath: string, remotePath: string) {
    const fileStat = await stat(localPath);
    const fileSize = fileStat.size;
    const contentType = lookupMime(localPath) || "application/octet-stream";
    const intentResponse = await this.request("/api/v1/fs/upload-intents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: remotePath,
        contentType,
        size: fileSize,
      }),
    });
    const intent = uploadIntentSchema.parse(await intentResponse.json());
    const progress = new TransferProgress(`Upload ${path.basename(localPath)}`, fileSize);
    let uploadedBytes = 0;
    const progressStream = new Transform({
      transform(chunk, _encoding, callback) {
        uploadedBytes += chunk.length;
        progress.update(uploadedBytes);
        callback(null, chunk);
      },
    });

    let uploadResponse: Response;
    try {
      const uploadBody = Readable.toWeb(createReadStream(localPath).pipe(progressStream)) as ReadableStream;
      uploadResponse = await fetch(intent.url, {
        method: intent.method,
        headers: {
          ...intent.headers,
          "Content-Length": String(fileSize),
        },
        body: uploadBody,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      if (!uploadResponse.ok) {
        throw new Error(`R2 upload failed with status ${uploadResponse.status}`);
      }
      progress.complete();
    } catch (error) {
      progress.fail();
      throw error;
    }

    const commitResponse = await this.request(`/api/v1/fs/uploads/${intent.uploadId}/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        etag: uploadResponse.headers.get("etag") ?? "uploaded",
      }),
    });

    return await commitResponse.json();
  }

  private async writeRemoteFile(remotePath: string, localPath?: string) {
    const response = await this.request(`/api/v1/fs/download?path=${encodeURIComponent(remotePath)}`);
    let destination = resolveFileDestination(remotePath, localPath);
    if (localPath) {
      try {
        const localStat = await stat(localPath);
        if (localStat.isDirectory()) {
          destination = path.join(localPath, getRemoteLeafName(remotePath));
        }
      } catch {
        // Treat a missing path as the intended file destination.
      }
    }

    await mkdir(path.dirname(destination), { recursive: true });
    const totalBytes = Number(response.headers.get("content-length") ?? 0);
    const progress = new TransferProgress(`Download ${path.basename(destination)}`, totalBytes || 0);
    const body = response.body;
    if (!body) {
      progress.fail();
      throw new Error(`No response body returned for ${remotePath}`);
    }

    const writer = createWriteStream(destination);
    const reader = body.getReader();
    let writtenBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        writtenBytes += value.byteLength;
        progress.update(totalBytes > 0 ? writtenBytes : Math.max(writtenBytes, 1));

        await new Promise<void>((resolve, reject) => {
          writer.write(Buffer.from(value), (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }

      await new Promise<void>((resolve, reject) => {
        writer.end((error: Error | null | undefined) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      if (totalBytes > 0) {
        progress.complete();
      } else {
        progress.update(writtenBytes);
        progress.complete();
      }
    } catch (error) {
      progress.fail();
      writer.destroy();
      throw error;
    }

    return destination;
  }

  async download(remotePath: string, localPath?: string) {
    let isFolder = false;
    try {
      await this.list(remotePath);
      isFolder = true;
    } catch {
      isFolder = false;
    }

    if (!isFolder) {
      return this.writeRemoteFile(remotePath, localPath);
    }

    const destinationRoot = resolveFolderDestination(remotePath, localPath);
    await mkdir(destinationRoot, { recursive: true });

    const tree = await this.tree(remotePath);
    const flattened = flattenTree(tree.tree);

    for (const directory of flattened.directories) {
      await mkdir(joinRelativeDestination(destinationRoot, directory), { recursive: true });
    }

    for (const file of flattened.files) {
      await this.writeRemoteFile(file.path, joinRelativeDestination(destinationRoot, file.relativePath));
    }

    console.error(summarizeFolderDownload(flattened.files.length, destinationRoot));
    return destinationRoot;
  }

  async share(pathname: string, ttl = "15m") {
    const response = await this.request("/api/v1/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathname, ttl }),
    });
    return shareCreateResponseSchema.parse(await response.json());
  }

  async listTokens() {
    const response = await this.request("/api/v1/tokens");
    return tokenListResponseSchema.parse(await response.json());
  }

  async createToken(label: string, ttl?: string) {
    const response = await this.request("/api/v1/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, ttl }),
    });
    return tokenCreateResponseSchema.parse(await response.json());
  }

  async listShares() {
    const response = await this.request("/api/v1/shares");
    return shareListResponseSchema.parse(await response.json());
  }
}
