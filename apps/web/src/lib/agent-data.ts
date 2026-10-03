import { parseCsv } from "./csv-inspector";
import { exportCsv } from "./csv-download";

function table(source: string, delimiter: string) {
  const rows = parseCsv(source, delimiter),
    header = rows[0];
  if (
    !header?.length ||
    header.some((h) => !h.trim()) ||
    new Set(header).size !== header.length
  )
    throw new Error("Provide nonempty, unique column headers.");
  if (rows.some((r) => r.length !== header.length))
    throw new Error(
      "Every row must have the same number of columns as the header.",
    );
  return rows;
}
export function projectCsv(source: string, columns: string[], delimiter = ",") {
  const rows = table(source, delimiter);
  if (!columns.length || new Set(columns).size !== columns.length)
    throw new Error(
      "Choose distinct column names, one per line, in output order.",
    );
  const indices = columns.map((c) => {
    const i = rows[0].indexOf(c);
    if (i < 0) throw new Error("Unknown column: " + c);
    return i;
  });
  return exportCsv(
    rows.map((r) => indices.map((i) => r[i])),
    delimiter,
  );
}
export function joinCsv(
  left: string,
  right: string,
  key: string,
  mode: string,
  delimiter = ",",
) {
  const a = table(left, delimiter),
    b = table(right, delimiter),
    ai = a[0].indexOf(key),
    bi = b[0].indexOf(key);
  if (ai < 0 || bi < 0)
    throw new Error("The join key must be a column in both tables.");
  if (!["left", "inner"].includes(mode))
    throw new Error("Choose left or inner join.");
  const lookup = new Map<string, string[]>();
  for (const row of b.slice(1)) {
    if (!row[bi] || lookup.has(row[bi]))
      throw new Error("Right-side keys must be nonempty and unique.");
    lookup.set(row[bi], row);
  }
  const extra = b[0].map((_, i) => i).filter((i) => i !== bi),
    used = new Set(a[0]);
  const names = extra.map((i) => {
    let name = b[0][i];
    while (used.has(name)) name = "right." + name;
    used.add(name);
    return name;
  });
  const rows = [a[0].concat(names)];
  for (const row of a.slice(1)) {
    const match = lookup.get(row[ai]);
    if (match || mode === "left")
      rows.push(row.concat(extra.map((i) => match?.[i] ?? "")));
  }
  return exportCsv(rows, delimiter);
}
export function csvMarkdown(source: string, delimiter = ",") {
  const rows = table(source, delimiter);
  const escape = (s: string) =>
    s
      .replaceAll("\\", "\\\\")
      .replaceAll("|", "\\|")
      .replace(/\r\n|\r|\n/g, " ")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const line = (r: string[]) => "| " + r.map(escape).join(" | ") + " |";
  return (
    [
      line(rows[0]),
      line(rows[0].map(() => "---")),
      ...rows.slice(1).map(line),
    ].join("\n") + "\n"
  );
}
export function compareLineSets(
  left: string,
  right: string,
  mode: string,
  normalize: string,
) {
  const lines = (s: string) => {
    const result = s.split(/\r\n|\n|\r/);
    if (/\r$|\n$/.test(s)) result.pop();
    if (!s) return [];
    if (result.length > 10000)
      throw new Error("Use at most 10,000 lines per input.");
    return result.map((line) => (normalize === "trim" ? line.trim() : line));
  };
  const a = new Set(lines(left)),
    b = new Set(lines(right));
  if (mode === "intersection") return [...a].filter((x) => b.has(x));
  if (mode === "left-only") return [...a].filter((x) => !b.has(x));
  if (mode === "right-only") return [...b].filter((x) => !a.has(x));
  if (mode === "union") return [...new Set([...a, ...b])];
  throw new Error("Unsupported set operation.");
}

/** Deliberately limited glob syntax, evaluated with DP rather than user regex. */
export function matchesPathGlob(path: string, glob: string) {
  if (
    !path.startsWith("/") ||
    !glob.startsWith("/") ||
    path.length > 4096 ||
    glob.length > 256
  )
    throw new Error(
      "Use absolute paths up to 4,096 characters and patterns up to 256.",
    );
  const tokens: string[] = [];
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        tokens.push("**/");
        i++;
      } else tokens.push("**");
    } else tokens.push(glob[i]);
  }
  let prior = new Uint8Array(path.length + 1);
  prior[0] = 1;
  for (const token of tokens) {
    const next = new Uint8Array(path.length + 1);
    if (token === "*" || token === "**" || token === "**/") {
      next[0] = prior[0];
      let reachable = !!prior[0];
      for (let j = 1; j <= path.length; j++) {
        if (token === "**/") {
          next[j] = +(!!prior[j] || (reachable && path[j - 1] === "/"));
          reachable ||= !!prior[j];
        } else
          next[j] = +(
            !!prior[j] ||
            (!!next[j - 1] && (token === "**" || path[j - 1] !== "/"))
          );
      }
    } else
      for (let j = 1; j <= path.length; j++)
        next[j] = +(
          !!prior[j - 1] &&
          (token === "?" ? path[j - 1] !== "/" : path[j - 1] === token)
        );
    prior = next;
  }
  return !!prior[path.length];
}
export function testPathScope(source: string, pattern: string) {
  const paths = source.split(/\r\n|\n|\r/).filter(Boolean);
  if (paths.length > 500) throw new Error("Test at most 500 paths at a time.");
  if (
    paths.reduce((sum, path) => sum + path.length, 0) * pattern.length >
    4000000
  )
    throw new Error(
      "Scope test is too large. Use fewer paths or a shorter pattern.",
    );
  return paths.map((path) => ({
    path,
    matches: matchesPathGlob(path, pattern),
  }));
}
