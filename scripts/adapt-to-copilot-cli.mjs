#!/usr/bin/env node
// scripts/adapt-to-copilot-cli.mjs
// Phase 2 adaptation pass: swap Claude Code-isms for Copilot CLI equivalents
// across ported agents and skills. Idempotent.

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TARGETS = [
  join(ROOT, ".github", "agents"),
  join(ROOT, ".github", "skills"),
];

// Tool name remappings: Claude Code (PascalCase) → Copilot CLI (lowercase).
// Applied as word-boundary regex so we don't corrupt arbitrary text.
const TOOL_MAP = [
  ["Read", "view"],
  ["Write", "create"],
  ["Edit", "edit"],
  ["MultiEdit", "edit"],
  ["Grep", "grep"],
  ["Glob", "glob"],
  ["Bash", "bash"],
  ["WebFetch", "web_fetch"],
  ["WebSearch", "web_search"],
  ["Task", "task"],
  ["TodoWrite", "sql"],
];

// Frontmatter keys that Copilot CLI doesn't understand and that would be
// confusing to leave in.
const STRIP_FRONTMATTER_KEYS = ["model", "level", "disallowedTools", "allowedTools", "argument-hint"];

function adaptFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return content;
  const fmRaw = m[1];
  const lines = fmRaw.split("\n");
  const kept = [];
  for (const line of lines) {
    const km = line.match(/^([\w-]+):/);
    if (km && STRIP_FRONTMATTER_KEYS.includes(km[1])) continue;
    kept.push(line);
  }
  // Ensure `name` and `description` are present (required by Copilot CLI)
  const hasName = kept.some((l) => /^name:/.test(l));
  const hasDesc = kept.some((l) => /^description:/.test(l));
  if (!hasName || !hasDesc) {
    return content; // leave for human review
  }
  return content.replace(m[0], `---\n${kept.join("\n").replace(/\n+$/, "")}\n---\n`);
}

function adaptToolReferences(content) {
  let out = content;
  for (const [from, to] of TOOL_MAP) {
    // Only swap when the word appears in obviously tool-context contexts:
    //   "use Edit", "Edit tool", "via Edit", "with Bash", "via Read",
    //   `Edit`, `Read`, etc. (backticks)
    // Avoid swapping inside English sentences like "Read the docs" or
    // "Edit your changes".
    const patterns = [
      new RegExp("`" + from + "`", "g"),
      new RegExp("\\b(use|using|with|via|invoke|call)\\s+" + from + "\\b", "g"),
      new RegExp("\\b" + from + "\\s+tool\\b", "g"),
    ];
    out = out.replace(patterns[0], "`" + to + "`");
    out = out.replace(patterns[1], (m, verb) => `${verb} \`${to}\``);
    out = out.replace(patterns[2], `\`${to}\` tool`);
  }
  return out;
}

let filesEdited = 0;

function processFile(path) {
  if (!path.endsWith(".md")) return;
  const original = readFileSync(path, "utf8");
  let updated = adaptFrontmatter(original);
  updated = adaptToolReferences(updated);
  if (updated !== original) {
    writeFileSync(path, updated);
    filesEdited++;
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else processFile(p);
  }
}

for (const t of TARGETS) walk(t);
console.log(`Adapted ${filesEdited} files.`);
