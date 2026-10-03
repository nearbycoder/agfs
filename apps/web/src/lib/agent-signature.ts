export async function verifyAgentWebhook(
  body: string,
  secret: string,
  timestamp: string,
  signature: string,
  now = Date.now(),
) {
  if (!secret || secret.length > 4096)
    throw new Error("Provide a signing secret up to 4,096 characters.");
  if (!/^\d{1,12}$/.test(timestamp))
    throw new Error("Timestamp must be Unix seconds from X-AGFS-Timestamp.");
  const parts = signature.split(",").map((s) => s.trim());
  if (!parts.length || parts.some((s) => !/^v1=[0-9a-f]{64}$/i.test(s)))
    throw new Error("Use the v1=<64 hex characters> signature header.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const payload = new TextEncoder().encode(timestamp + "." + body);
  const checks = await Promise.all(
    parts.map((part) =>
      crypto.subtle.verify(
        "HMAC",
        key,
        Uint8Array.from(part.slice(3).match(/../g)!, (byte) =>
          parseInt(byte, 16),
        ),
        payload,
      ),
    ),
  );
  const ageSeconds = Math.floor(now / 1000) - Number(timestamp);
  return {
    signatureValid: checks.some(Boolean),
    timestampFresh: ageSeconds >= 0 && ageSeconds <= 300,
    ageSeconds,
    accepted: checks.some(Boolean) && ageSeconds >= 0 && ageSeconds <= 300,
    note: "Also deduplicate X-AGFS-Event-ID in your receiver. This tool sends no network request.",
  };
}
