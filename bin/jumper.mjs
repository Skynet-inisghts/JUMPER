#!/usr/bin/env node
// The CLI runs the compiled engine in .jumper-build (source: src/).
// `pnpm build:cli` once after cloning; `pnpm jumper <ca>` from then on.
try {
  await import("../.jumper-build/cli/main.js");
} catch (error) {
  if (error.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes(".jumper-build")) {
    process.stderr.write("jumper: run pnpm build:cli before using the CLI\n");
    process.exit(1);
  }
  throw error;
}
