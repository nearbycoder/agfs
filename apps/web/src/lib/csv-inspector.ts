export function parseCsv(text: string, delimiter = ","): string[][] {
  if (![",", ";", "\t"].includes(delimiter))
    throw new Error("Unsupported delimiter");
  if (text.length > 262144) throw new Error("CSV exceeds 256 KiB");
  text = text.replace(/^\uFEFF/, "");
  if (!text) return [];
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  function cell() {
    row.push(field);
    field = "";
    closed = false;
    if (row.length > 200) throw new Error("CSV exceeds 200 columns");
  }
  function record() {
    cell();
    rows.push(row);
    row = [];
    if (rows.length > 5000) throw new Error("CSV exceeds 5,000 rows");
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === delimiter) {
      cell();
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record();
      continue;
    }
    if (closed) throw new Error("Unexpected character after a closing quote");
    if (c === '"') {
      if (field) throw new Error("Quote inside an unquoted field");
      quoted = true;
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed quoted field");
  if (
    field ||
    closed ||
    row.length ||
    (!text.endsWith("\n") && !text.endsWith("\r"))
  )
    record();
  return rows;
}
