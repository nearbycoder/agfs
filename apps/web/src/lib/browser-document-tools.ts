import { parseExactJson } from "./lossless-json";
import {
  boundedText,
  featureResult,
  isObject,
  requireChoice,
  workBudget,
  FEATURE_BYTES,
  reportArray,
  reportWriter,
  type Budget,
} from "./browser-feature-core";

/** ATX headings: <=3 leading spaces, 1–6 hashes, whitespace, title, optional closing hashes. */
export function taskHeading(text: string, tick: Budget): string | null {
  let start = 0;
  while (start < 3 && text[start] === " ") {
    tick();
    start++;
  }
  let hashes = 0;
  while (text[start] === "#" && hashes < 6) {
    tick();
    start++;
    hashes++;
  }
  if (!hashes || !/\s/.test(text[start] ?? "")) return null;
  const separator = start;
  while (start < text.length && /\s/.test(text[start])) {
    tick();
    start++;
  }
  // Preserve the original one-character title capture for whitespace-only
  // headings, while still requiring a separate whitespace separator.
  if (start === text.length) {
    start--;
    while (start > separator && /[\u2028\u2029]/.test(text[start])) {
      tick();
      start--;
    }
  }
  if (start <= separator) return null;
  let end = text.length;
  while (end > start + 1 && /\s/.test(text[end - 1])) {
    tick();
    end--;
  }
  while (end > start + 1 && text[end - 1] === "#") {
    tick();
    end--;
  }
  while (end > start + 1 && /\s/.test(text[end - 1])) {
    tick();
    end--;
  }
  // Charge the remaining title extent as well; no backtracking search is used.
  tick(end - start);
  const title = text.slice(start, end);
  return /[\u2028\u2029]/.test(title) ? null : title;
}

/** Match split(/\r\n|\r|\n/) line counts without allocating a line array. */
function checkDocumentLineCount(source: string) {
  let lines = 1;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code !== 10 && code !== 13) continue;
    if (++lines > 10000)
      throw new Error("Use a document with at most 10,000 lines.");
    if (code === 13 && source.charCodeAt(i + 1) === 10) i++;
  }
}

function documentLines(source: string) {
  const lines = source.split(/\r\n|\r|\n/);
  let fence = "",
    width = 0;
  return lines.map((text, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    let content = !fence;
    if (marker) {
      content = false;
      if (!fence) {
        fence = marker[1][0];
        width = marker[1].length;
      } else if (
        marker[1][0] === fence &&
        marker[1].length >= width &&
        !marker[2].trim()
      )
        fence = "";
    }
    return {
      text,
      line: index + 1,
      content: content && !/^( {4}|\t)/.test(text),
    };
  });
}
function withoutCode(text: string) {
  // Ignore matched inline backtick spans; unmatched ticks remain literal.
  let result = "",
    cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("`", cursor);
    if (start < 0) return result + text.slice(cursor);
    let endRun = start + 1;
    while (text[endRun] === "`") endRun++;
    const marker = text.slice(start, endRun),
      end = text.indexOf(marker, endRun);
    if (end < 0) return result + text.slice(cursor);
    result +=
      text.slice(cursor, start) + " ".repeat(end + marker.length - start);
    cursor = end + marker.length;
  }
  return result;
}
export function linkKind(target: string) {
  if (
    !target ||
    /[\s<>\\\u0000-\u001f\u007f]/.test(target) ||
    /&(?:#\w+|[a-z]+);/i.test(target)
  )
    return "review";
  if (target.startsWith("#")) return "anchor";
  if (target.startsWith("//")) return "external";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(target)?.[1].toLowerCase();
  if (!scheme) return "relative";
  if (scheme === "https" || scheme === "http") {
    try {
      const url = new URL(target);
      return url.hostname ? scheme : "review";
    } catch {
      return "review";
    }
  }
  if (scheme === "mailto") return "email";
  return "unsafe scheme";
}

export function runDocumentTool(
  id: string,
  input: string,
  secondary: string,
  options: Record<string, string>,
) {
  boundedText(input);
  checkDocumentLineCount(input);
  boundedText(secondary, "Redaction rules");
  const tick = workBudget();
  if (id === "document-redact") {
    const config = parseExactJson(secondary);
    if (!Array.isArray(config) || !config.length || config.length > 100)
      throw new Error(
        "Provide 1–100 rules with name and literal string fields.",
      );
    const seen = new Set<string>(),
      names = new Set<string>();
    const rules = config.map((item, index) => {
      if (
        !isObject(item) ||
        typeof item.name !== "string" ||
        typeof item.literal !== "string" ||
        !item.name.trim() ||
        !item.literal
      )
        throw new Error(
          `Rule ${index + 1}: provide a nonempty name and literal.`,
        );
      if (item.name.length > 80 || item.literal.length > 1024)
        throw new Error(
          "Rule names are limited to 80 characters and literals to 1,024 characters.",
        );
      if (seen.has(item.literal) || names.has(item.name))
        throw new Error("Each literal and rule name must be unique.");
      seen.add(item.literal);
      names.add(item.name);
      return {
        name: item.name,
        literal: item.literal,
        count: 0,
        replacement: `[REDACTED:${item.name}]`,
      };
    });
    // A trie makes overlap resolution linear in checked prefixes, without user regex.
    type Node = { children: Map<string, Node>; rule?: (typeof rules)[number] };
    const root: Node = { children: new Map() };
    for (const rule of rules) {
      let node = root;
      for (let i = 0; i < rule.literal.length; i++) {
        tick();
        const child = node.children.get(rule.literal[i]) ?? {
          children: new Map(),
        };
        node.children.set(rule.literal[i], child);
        node = child;
      }
      node.rule = rule;
    }
    const chunks: string[] = [],
      encoder = new TextEncoder();
    let start = 0,
      cursor = 0,
      bytes = 0;
    const append = (part: string) => {
      bytes += encoder.encode(part).length;
      if (bytes > FEATURE_BYTES)
        throw new Error(
          "Redacted output exceeds 256 KiB. Use shorter rule names or a smaller input.",
        );
      chunks.push(part);
    };
    while (cursor < input.length) {
      let node = root,
        end = cursor,
        match: (typeof rules)[number] | undefined,
        matchEnd = cursor;
      while (end < input.length) {
        tick();
        const next = node.children.get(input[end]);
        if (!next) break;
        node = next;
        end++;
        if (node.rule) {
          match = node.rule;
          matchEnd = end;
        }
      }
      if (match) {
        append(input.slice(start, cursor));
        append(match.replacement);
        match.count++;
        cursor = matchEnd;
        start = cursor;
      } else cursor++;
    }
    append(input.slice(start));
    return featureResult(
      chunks.join(""),
      "redacted.txt",
      `${rules.reduce((n, r) => n + r.count, 0)} literal matches replaced. Only configured literals were checked; review all output before sharing.`,
      {
        columns: ["Rule", "Replacements"],
        rows: rules.map((r) => [r.name, String(r.count)]),
      },
    );
  }
  const lines = documentLines(input);
  if (id === "document-tasks") {
    requireChoice(options.status, ["all", "open", "complete"], "task status");
    const tasks: {
      line: number;
      status: string;
      heading: string;
      text: string;
    }[] = [];
    const report = reportArray();
    let heading = "";
    for (const line of lines) {
      if (!line.content) continue;
      const title = taskHeading(line.text, tick);
      if (title !== null) heading = title;
      const task = /^ {0,3}(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/.exec(
        line.text,
      );
      if (!task) continue;
      const status = task[1] === " " ? "open" : "complete";
      if (options.status !== "all" && options.status !== status) continue;
      if (tasks.length >= 1000)
        throw new Error(
          "More than 1,000 matching tasks. Filter by status or use a smaller document.",
        );
      const item = { line: line.line, status, heading, text: task[2] };
      report.push(item);
      tasks.push(item);
    }
    return featureResult(
      report.finish(),
      "markdown-tasks.json",
      `${tasks.length} tasks in the selected status. Line numbers refer to the source document.`,
      {
        columns: ["Line", "Status", "Heading", "Task"],
        rows: tasks.map((t) => [String(t.line), t.status, t.heading, t.text]),
      },
    );
  }
  if (id === "document-links") {
    requireChoice(options.filter, ["all", "review"], "link filter");
    const report = reportWriter();
    report.raw('{"links":[');
    const links: {
      line: number;
      kind: string;
      label: string;
      target: string;
      classification: string;
    }[] = [];
    let unsupported = 0,
      seen = 0;
    for (const line of lines) {
      if (!line.content) continue;
      const text = withoutCode(line.text);
      let cursor = 0;
      while (cursor < text.length) {
        const open = text.indexOf("[", cursor);
        if (open < 0) break;
        // Bound each candidate's search window and charge it to the work budget.
        const window = text.slice(open + 1, open + 1026);
        tick(window.length + 1);
        const close = window.indexOf("]("),
          nested = window.indexOf("[");
        if (
          close < 0 ||
          (nested >= 0 && nested < close) ||
          text[open - 1] === "\\"
        ) {
          cursor = open + 1;
          continue;
        }
        const targetStart = open + close + 3,
          destination = text.slice(targetStart, targetStart + 4097);
        tick(destination.length);
        const end = destination.indexOf(")");
        if (end < 0) {
          unsupported++;
          cursor = targetStart + destination.length;
          continue;
        }
        const target = destination.slice(0, end);
        cursor = targetStart + end + 1;
        if (
          target.includes("(") ||
          /\s/.test(target) ||
          window.slice(0, close).includes("\\")
        ) {
          unsupported++;
          continue;
        }
        if (++seen > 1000)
          throw new Error(
            "More than 1,000 inline links. Use a smaller document.",
          );
        const item = {
          line: line.line,
          kind: text[open - 1] === "!" ? "image" : "link",
          label: window.slice(0, close),
          target,
          classification: linkKind(target),
        };
        if (
          options.filter === "review" &&
          !["unsafe scheme", "review", "http", "external"].includes(
            item.classification,
          )
        )
          continue;
        if (links.length) report.raw(",");
        report.json(item);
        links.push(item);
      }
    }
    const selected = links;
    report.raw('],"unsupportedCandidates":');
    report.json(unsupported);
    report.raw("}");
    return featureResult(
      report.finish(),
      "markdown-links.json",
      `${selected.length} inline links/images listed · ${unsupported} unsupported candidates skipped. Targets are not fetched or opened; classifications are not a safety guarantee.`,
      {
        columns: ["Line", "Kind", "Label", "Target", "Classification"],
        rows: selected.map((l) => [
          String(l.line),
          l.kind,
          l.label,
          l.target,
          l.classification,
        ]),
      },
    );
  }
  throw new Error("Choose a document preparation task.");
}
