#!/usr/bin/env node
// Build script invoked by `npm run build` at the package root.
// Compiles the bundled mcp-server TypeScript into dist/.

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = resolve(here, "..", "mcp-server");

console.log(`[omcc] building mcp-server in ${mcpRoot}`);
const r = spawnSync("npm", ["run", "build"], {
  cwd: mcpRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
