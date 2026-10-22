export type JsonNode = {
  path: string;
  depth: number;
  label: string;
  value: string;
  container: boolean;
};
export function inspectJson(text: string) {
  if (text.length > 262144) throw new Error("JSON exceeds 256 KiB");
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new Error(
      "Invalid JSON: " + (e instanceof Error ? e.message : "syntax error"),
    );
  }
  const nodes: JsonNode[] = [];
  function visit(value: unknown, path: string, depth: number, label: string) {
    if (depth > 40) throw new Error("JSON exceeds the inspection depth of 40");
    if (nodes.length >= 10000)
      throw new Error("JSON exceeds 10,000 inspected values");
    const container = value !== null && typeof value === "object";
    nodes.push({
      path,
      depth,
      label,
      container,
      value: container
        ? Array.isArray(value)
          ? `Array (${value.length})`
          : `Object (${Object.keys(value).length})`
        : typeof value === "number" && !Number.isFinite(value)
          ? String(value)
          : JSON.stringify(value),
    });
    if (container)
      for (const [key, child] of Object.entries(value))
        visit(
          child,
          path + "/" + key.replace(/~/g, "~0").replace(/\//g, "~1"),
          depth + 1,
          key,
        );
  }
  visit(value, "", 0, "root");
  let formatted: string | undefined;
  return {
    nodes,
    get formatted() {
      return (formatted ??= formatJsonSource(text.replace(/^\uFEFF/, "")));
    },
  };
}

// Format validated source tokens without changing number precision or duplicate keys.
function formatJsonSource(text: string) {
  let output = "",
    depth = 0,
    quoted = false,
    escaped = false;
  const newline = () => {
    output += "\n" + "  ".repeat(depth);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      output += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      output += c;
    } else if (c === "{" || c === "[") {
      output += c;
      depth++;
      newline();
    } else if (c === "}" || c === "]") {
      depth--;
      newline();
      output += c;
    } else if (c === ",") {
      output += c;
      newline();
    } else if (c === ":") output += ": ";
    else if (!/\s/.test(c)) output += c;
  }
  return output;
}

/** Nodes are preorder: a collapsed container hides consecutive deeper nodes. */
export function visibleJsonNodes(
  nodes: JsonNode[],
  collapsed: ReadonlySet<string>,
  query = "",
) {
  const needle = query.toLowerCase();
  if (needle)
    return nodes.filter((n) =>
      (n.path + " " + n.label + " " + n.value).toLowerCase().includes(needle),
    );
  const visible: JsonNode[] = [];
  let hiddenBelow = Infinity;
  for (const node of nodes) {
    if (node.depth > hiddenBelow) continue;
    hiddenBelow = Infinity;
    visible.push(node);
    if (node.container && collapsed.has(node.path)) hiddenBelow = node.depth;
  }
  return visible;
}
