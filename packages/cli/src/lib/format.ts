import type { AccountSummary, FsEntry, FsTreeNode } from "@agfs/contracts";

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function renderMeter(currentBytes: number, limitBytes: number, width = 24) {
  if (limitBytes <= 0) {
    return `[${"-".repeat(width)}]`;
  }

  const ratio = Math.min(currentBytes / limitBytes, 1);
  const filled = Math.round(ratio * width);
  return `[${"#".repeat(filled).padEnd(width, "-")}]`;
}

function wrapInBox(title: string, lines: string[]) {
  const width = Math.max(title.length, ...lines.map((line) => line.length));
  const top = `╭${"─".repeat(width + 2)}╮`;
  const bottom = `╰${"─".repeat(width + 2)}╯`;
  const content = [`│ ${title.padEnd(width)} │`, ...lines.map((line) => `│ ${line.padEnd(width)} │`)];
  return [top, ...content, bottom].join("\n");
}

export function renderAccountSummary(summary: AccountSummary) {
  const percentUsed = summary.storageLimitBytes > 0
    ? Math.round((summary.storageUsedBytes / summary.storageLimitBytes) * 100)
    : 0;
  const status = summary.isOverLimit
    ? `Over by ${formatStorageBytes(summary.storageUsedBytes - summary.storageLimitBytes)}`
    : `${percentUsed}% used`;
  const lines = [
    `Plan      ${summary.planName}`,
    `Used      ${formatStorageBytes(summary.storageUsedBytes)} / ${formatStorageBytes(summary.storageLimitBytes)}`,
    `Left      ${formatStorageBytes(summary.storageRemainingBytes)}`,
    `Status    ${status}`,
    `Meter     ${renderMeter(summary.storageUsedBytes, summary.storageLimitBytes)}`,
    ...(summary.paidPlanComingSoon && summary.planId === "free" ? ["Upgrade   Paid self-serve is coming soon"] : []),
  ];

  return wrapInBox("AGFS storage", lines);
}

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
