export function folderTarget(input: string) {
  if (!input.startsWith("/") || input.length > 4096)
    throw new Error(
      "Enter an absolute folder path, starting with /, up to 4,096 characters.",
    );
  if (/[\\\u0000-\u001f\u007f]/.test(input))
    throw new Error(
      "Folder paths cannot contain backslashes or control characters.",
    );
  const parts = input
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.some((p) => p === "." || p === ".."))
    throw new Error("Use a full path without . or .. segments.");
  return "/" + parts.join("/");
}
