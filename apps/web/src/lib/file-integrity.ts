export async function sha256(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function compareDigest(actual: string, expected: string) {
  const normalized = expected.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized))
    throw new Error(
      "Expected SHA-256 must contain exactly 64 hexadecimal characters.",
    );
  return actual.toLowerCase() === normalized;
}
