export function LineDiff({ before, after }: { before: string; after: string }) {
  const a = before.split("\n"),
    b = after.split("\n");
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix++;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const rows = [
    ...a.slice(Math.max(0, prefix - 3), prefix).map((text, i) => ({
      text,
      sign: " ",
      line: Math.max(0, prefix - 3) + i + 1,
    })),
    ...a
      .slice(prefix, a.length - suffix)
      .map((text, i) => ({ text, sign: "−", line: prefix + i + 1 })),
    ...b
      .slice(prefix, b.length - suffix)
      .map((text, i) => ({ text, sign: "+", line: prefix + i + 1 })),
    ...b
      .slice(b.length - suffix, b.length - suffix + 3)
      .map((text, i) => ({ text, sign: " ", line: b.length - suffix + i + 1 })),
  ];
  return (
    <pre
      aria-label="Line changes"
      className="max-h-96 overflow-auto rounded-lg border p-3 text-xs"
    >
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            r.sign === "+"
              ? "bg-green-100 text-green-950 dark:bg-green-950 dark:text-green-100"
              : r.sign === "−"
                ? "bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100"
                : ""
          }
        >
          <span className="inline-block w-14 select-none opacity-60">
            {r.sign} {r.line}
          </span>
          {r.text || " "}
        </div>
      ))}
    </pre>
  );
}
