import path from "node:path";
import type { FsTreeNode } from "@agfs/contracts";

export interface FlattenedTree {
  directories: string[];
  files: Array<{
    path: string;
    relativePath: string;
  }>;
}

export function getRemoteLeafName(remotePath: string): string {
  const normalized = remotePath.replace(/\/+$/, "");
  if (!normalized || normalized === "/") {
    return "agfs-root";
  }

  return normalized.split("/").filter(Boolean).at(-1) ?? "agfs-root";
}

export function flattenTree(nodes: FsTreeNode[]): FlattenedTree {
  const directories: string[] = [];
  const files: Array<{ path: string; relativePath: string }> = [];

  function walk(items: FsTreeNode[], parentSegments: string[]) {
    for (const item of items) {
      const segments = [...parentSegments, item.name];
      const relativePath = segments.join("/");

      if (item.kind === "folder") {
        directories.push(relativePath);
        walk((item.children ?? []) as FsTreeNode[], segments);
        continue;
      }

      files.push({
        path: item.path,
        relativePath,
      });
    }
  }

  walk(nodes, []);

  return { directories, files };
}

export function resolveFolderDestination(remotePath: string, localPath?: string): string {
  return localPath ?? getRemoteLeafName(remotePath);
}

export function resolveFileDestination(remotePath: string, localPath?: string): string {
  return localPath ?? getRemoteLeafName(remotePath);
}

export function joinRelativeDestination(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split("/"));
}
