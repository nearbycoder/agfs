export function profileColumn(rows: string[][], column: number, width: number) {
  if (rows.length > 5000 || width > 200 || column < 0 || column >= width)
    throw new Error("Choose a valid column within 5,000 rows and 200 columns.");
  const values = new Map<string, number>();
  let missing = 0,
    blank = 0,
    numeric = 0,
    min = Infinity,
    max = -Infinity,
    sum = 0;
  for (const row of rows) {
    if (column >= row.length) {
      missing++;
      continue;
    }
    const value = row[column];
    if (!value.trim()) {
      blank++;
      continue;
    }
    values.set(value, (values.get(value) ?? 0) + 1);
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        numeric++;
        min = Math.min(min, n);
        max = Math.max(max, n);
        sum += n;
      }
    }
  }
  return {
    total: rows.length,
    missing,
    blank,
    distinct: values.size,
    numeric,
    min: numeric ? min : null,
    max: numeric ? max : null,
    mean: numeric && Number.isFinite(sum) ? sum / numeric : null,
    common: [...values]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5),
    irregular: rows.filter((row) => row.length !== width).length,
  };
}
