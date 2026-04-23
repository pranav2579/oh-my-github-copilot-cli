#!/usr/bin/env node
// scripts/mcp-probe.mjs — portable MCP-stdio probe for E2E tests.
//
// Usage: node scripts/mcp-probe.mjs <path-to-mcp-server> <request-file>
//   - Spawns the MCP server.
//   - Pipes <request-file> contents to its stdin (newline-delimited JSON-RPC).
//   - Captures stdout (response stream) and discards stderr (warnings).
//   - Kills the server after 5s and prints stdout to our stdout.
//
// This avoids relying on coreutils `timeout` (missing on macOS by default)
// and keeps stderr noise (e.g., node SQLite ExperimentalWarning) out of
// the parsed response.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const [, , serverPath, reqPath] = process.argv;
if (!serverPath || !reqPath) {
  console.error("usage: mcp-probe.mjs <server.js> <request.txt>");
  process.exit(2);
}

const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

let stdout = "";
child.stdout.on("data", (b) => { stdout += b.toString("utf8"); });
child.stderr.on("data", () => {}); // discard warnings

child.stdin.write(readFileSync(reqPath, "utf8"));
// Don't end stdin yet — give the server time to respond before SIGKILL.

const KILL_AFTER_MS = 4000;
setTimeout(() => {
  try { child.kill("SIGKILL"); } catch {}
}, KILL_AFTER_MS);

child.on("exit", () => {
  process.stdout.write(stdout);
  process.exit(0);
});
