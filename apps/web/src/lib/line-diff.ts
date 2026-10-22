export const LINE_DIFF_PAGE_SIZE = 100;

/** Same prefix/suffix comparison as the draft review, without allocating every row. */
export function prepareLineDiff(before: string, after: string) {
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
  const leading = Math.min(3, prefix);
  const removed = a.length - prefix - suffix;
  const added = b.length - prefix - suffix;
  const trailing = Math.min(3, suffix);
  return {
    a,
    b,
    prefix,
    suffix,
    leading,
    removed,
    added,
    trailing,
    total: leading + removed + added + trailing,
  };
}

export function lineDiffPage(
  model: ReturnType<typeof prepareLineDiff>,
  requestedPage: number,
) {
  const pages = Math.max(1, Math.ceil(model.total / LINE_DIFF_PAGE_SIZE));
  const page = Math.min(
    pages - 1,
    Math.max(0, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0),
  );
  const start = page * LINE_DIFF_PAGE_SIZE;
  const rows: { text: string; sign: " " | "−" | "+"; line: number }[] = [];
  for (
    let offset = start;
    offset < Math.min(start + LINE_DIFF_PAGE_SIZE, model.total);
    offset++
  ) {
    if (offset < model.leading) {
      const index = model.prefix - model.leading + offset;
      rows.push({ text: model.a[index], sign: " ", line: index + 1 });
    } else if (offset < model.leading + model.removed) {
      const index = model.prefix + offset - model.leading;
      rows.push({ text: model.a[index], sign: "−", line: index + 1 });
    } else if (offset < model.leading + model.removed + model.added) {
      const index = model.prefix + offset - model.leading - model.removed;
      rows.push({ text: model.b[index], sign: "+", line: index + 1 });
    } else {
      const index =
        model.b.length -
        model.suffix +
        offset -
        model.leading -
        model.removed -
        model.added;
      rows.push({ text: model.b[index], sign: " ", line: index + 1 });
    }
  }
  return { rows, page, pages, start, end: start + rows.length };
}
