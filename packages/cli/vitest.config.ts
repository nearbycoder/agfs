import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// CI runs tests before builds. Test the workspace SDK source in a clean checkout.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@agfs\/sdk$/, replacement: fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)) }],
  },
});
