import type { FsEntry, FsTreeNode } from "@agfs/contracts";

export function renderEntries(entries: FsEntry[]) {
  if (entries.length === 0) {
    return "(empty)";
  }

  return entries
    .map((entry) => {
      const size = entry.size == null ? "folder" : `${entry.size} bytes`;
      return `${entry.path}\t${entry.kind}\t${size}`;
    })
    .join("\n");
}

function renderTreeNode(node: FsTreeNode, prefix: string, isLast: boolean): string[] {
  const branch = prefix ? `${prefix}${isLast ? "└─ " : "├─ "}` : "";
  const lines = [`${branch}${node.name}${node.kind === "folder" ? "/" : ""}`];
  const nextPrefix = prefix ? `${prefix}${isLast ? "   " : "│  "}` : "";
  const children = (node.children ?? []) as FsTreeNode[];
  children.forEach((child, index) => {
    lines.push(...renderTreeNode(child, nextPrefix, index === children.length - 1));
  });
  return lines;
}

export function renderTree(nodes: FsTreeNode[]) {
  if (nodes.length === 0) {
    return "(empty)";
  }

  return nodes.flatMap((node, index) => renderTreeNode(node, "", index === nodes.length - 1)).join("\n");
}
