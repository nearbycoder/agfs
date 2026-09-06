import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // Executable-only package; typecheck with the native TypeScript compiler.
  dts: false,
  clean: true,
  target: "es2022",
  noExternal: ["@agfs/contracts"],
});
