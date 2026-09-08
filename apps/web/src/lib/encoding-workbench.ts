export type Encoding = "utf8" | "base64" | "hex";
export function convertEncoding(input: string, from: Encoding, to: Encoding) {
  if (new TextEncoder().encode(input).length > 262144)
    throw new Error("Input is limited to 256 KiB.");
  let bytes: Uint8Array;
  if (from === "utf8") {
    if (/[\uD800-\uDFFF]/u.test(input))
      throw new Error("Input contains an unpaired Unicode surrogate.");
    bytes = new TextEncoder().encode(input);
  } else if (from === "hex") {
    const source = input.replace(/\s/g, "");
    if (!/^(?:[a-fA-F0-9]{2})*$/.test(source))
      throw new Error("Hex must contain complete pairs of hexadecimal digits.");
    bytes = Uint8Array.from(source.match(/../g) ?? [], (pair) =>
      parseInt(pair, 16),
    );
  } else {
    const source = input.replace(/\s/g, "");
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        source,
      )
    )
      throw new Error(
        "Use standard padded Base64, with valid characters and padding.",
      );
    const binary = atob(source);
    if (btoa(binary) !== source)
      throw new Error("Base64 contains noncanonical padding bits.");
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }
  let output: string;
  if (to === "utf8") {
    try {
      output = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw new Error(
        "Decoded bytes are not valid UTF-8. Choose hex or Base64 to inspect binary data.",
      );
    }
  } else if (to === "hex")
    output = [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
  else {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    output = btoa(binary);
  }
  if (new TextEncoder().encode(output).length > 1048576)
    throw new Error("Output exceeds 1 MiB.");
  return { output, bytes: bytes.length };
}
