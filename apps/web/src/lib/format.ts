export function formatBytes(value: number | null, options?: { nullLabel?: string }) {
  if (value == null) {
    return options?.nullLabel ?? "0 B";
  }

  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} kB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${Math.round(value / 104857.6) / 10} MB`;
  }

  return `${Math.round(value / 107374182.4) / 10} GB`;
}

export function formatMonthlyPrice(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
