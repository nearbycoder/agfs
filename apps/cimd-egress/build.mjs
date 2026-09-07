import { build } from "esbuild";
await build({
  entryPoints: ["src/server.mjs"],
  outfile: "dist/server.txt",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  minify: true,
});
