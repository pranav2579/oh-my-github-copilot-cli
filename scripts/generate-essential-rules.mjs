#!/usr/bin/env node
// scripts/generate-essential-rules.mjs
// Reads L1 entries from the memory_layers table and generates
// .github/harness/essential-rules.md (the L1 context file).

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const DB_PATH =
  process.env.OMCC_DB ??
  join(process.env.HOME ?? homedir(), ".omcc", "state.sqlite");

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", ".github", "harness");
const OUTPUT_FILE = join(OUTPUT_DIR, "essential-rules.md");

const MAX_TOKENS = 800;
const MAX_CHARS = MAX_TOKENS * 4;

function main() {
  if (!existsSync(DB_PATH)) {
    console.log(`[generate-essential-rules] No database at ${DB_PATH}, creating empty L1 file.`);
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(OUTPUT_FILE, "# Essential Rules (L1)\n\nNo rules yet. Promote patterns from L2/L3.\n");
    return;
  }

  const db = new DatabaseSync(DB_PATH);

  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_layers'"
  ).get();

  if (!tableExists) {
    console.log("[generate-essential-rules] memory_layers table not found, creating empty L1 file.");
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(OUTPUT_FILE, "# Essential Rules (L1)\n\nNo rules yet. Promote patterns from L2/L3.\n");
    db.close();
    return;
  }

  const rows = db.prepare(
    "SELECT id, content, confidence, category FROM memory_layers WHERE level = 1 AND confidence >= 0.7 ORDER BY confidence DESC"
  ).all();

  const lines = ["# Essential Rules (L1)", "", `_Auto-generated. ${rows.length} rule(s). Do not edit manually._`, ""];

  const grouped = {};
  for (const row of rows) {
    const cat = row.category || "general";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(row);
  }

  for (const [category, entries] of Object.entries(grouped)) {
    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    lines.push("");
    for (const entry of entries) {
      lines.push(`- **${entry.id}** (confidence: ${entry.confidence}): ${entry.content}`);
    }
    lines.push("");
  }

  let content = lines.join("\n");

  if (content.length > MAX_CHARS) {
    content = content.slice(0, MAX_CHARS) + "\n\n_[truncated to ~800 tokens]_\n";
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, content);
  console.log(`[generate-essential-rules] Wrote ${rows.length} rules to ${OUTPUT_FILE} (${content.length} chars)`);
  db.close();
}

main();
