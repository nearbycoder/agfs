export const previewTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  "text/plain",
]);
export interface PreviewTicket {
  key: string;
  type: string;
  name: string;
  exp: number;
}
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
async function key(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}
export async function signTicket(ticket: PreviewTicket, secret: string) {
  const data = encode(new TextEncoder().encode(JSON.stringify(ticket)));
  return `${data}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(data))))}`;
}
export async function verifyTicket(token: string, secret: string): Promise<PreviewTicket | null> {
  try {
    if (token.length > 12000) return null;
    const [data, sig, ...extra] = token.split(".");
    if (
      extra.length ||
      !data ||
      !sig ||
      !(await crypto.subtle.verify("HMAC", await key(secret), decode(sig), new TextEncoder().encode(data)))
    )
      return null;
    const ticket = JSON.parse(new TextDecoder().decode(decode(data)));
    if (
      typeof ticket.key !== "string" ||
      typeof ticket.name !== "string" ||
      !previewTypes.has(ticket.type) ||
      !Number.isFinite(ticket.exp) ||
      ticket.exp <= Date.now() ||
      ticket.exp > Date.now() + 5 * 60_000
    )
      return null;
    return ticket;
  } catch {
    return null;
  }
}
