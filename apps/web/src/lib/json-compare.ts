import { type JsonValue, jsonKind, stringifyExactJson } from "./lossless-json";
import { pointerEscape } from "./json-pointer";
export type JsonChange = {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: string;
  after?: string;
};
export function compareJson(before: JsonValue, after: JsonValue) {
  const changes: JsonChange[] = [];
  let bytes = 0;
  function add(change: JsonChange) {
    bytes += new TextEncoder().encode(JSON.stringify(change)).length;
    if (changes.length >= 2000 || bytes > 1048576)
      throw new Error(
        "Comparison exceeds 2,000 changes or 1 MiB. Compare a smaller subtree.",
      );
    changes.push(change);
  }
  function visit(a: JsonValue, b: JsonValue, path: string) {
    const kind = jsonKind(a);
    if (kind !== jsonKind(b)) {
      add({
        path,
        kind: "changed",
        before: stringifyExactJson(a),
        after: stringifyExactJson(b),
      });
      return;
    }
    if (kind === "object" || kind === "array") {
      const left = a as { [k: string]: JsonValue },
        right = b as { [k: string]: JsonValue };
      for (const key of new Set([
        ...Object.keys(left),
        ...Object.keys(right),
      ])) {
        const child = path + "/" + pointerEscape(key);
        if (!Object.hasOwn(left, key))
          add({
            path: child,
            kind: "added",
            after: stringifyExactJson(right[key]),
          });
        else if (!Object.hasOwn(right, key))
          add({
            path: child,
            kind: "removed",
            before: stringifyExactJson(left[key]),
          });
        else visit(left[key], right[key], child);
      }
      return;
    }
    const x = stringifyExactJson(a),
      y = stringifyExactJson(b);
    if (x !== y) add({ path, kind: "changed", before: x, after: y });
  }
  visit(before, after, "");
  return changes;
}
