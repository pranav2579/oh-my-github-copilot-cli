// scripts/analyze-tokens.mjs
// Analyzes the token cost of all OMCC harness components (agents, skills,
// extensions, copilot-instructions) and produces a sorted report with
// trim-candidate recommendations.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";

const ROOT = process.cwd();
const TOKENS_PER_WORD = 1.3;
const TRIM_THRESHOLD = 2000;

// Estimate token count from text content.
export function estimateTokens(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words * TOKENS_PER_WORD);
}

function scanFiles(dir, filter, resolvePath, labelFn) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!filter(entry)) continue;
    const fullPath = resolvePath(dir, entry);
    try {
      const content = readFileSync(fullPath, "utf8");
      results.push({
        label: labelFn(entry),
        tokens: estimateTokens(content),
        path: fullPath,
      });
    } catch {
      // skip unreadable files
    }
  }
  return results;
}

// Scan .github/agents for agent.md files
export function scanAgents(root) {
  const dir = join(root, ".github", "agents");
  return scanFiles(
    dir,
    (e) => e.endsWith(".agent.md"),
    (d, e) => join(d, e),
    (e) => e,
  );
}

// Scan .github/skills for SKILL.md files
export function scanSkills(root) {
  const dir = join(root, ".github", "skills");
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const skillFile = join(dir, entry, "SKILL.md");
    try {
      if (!statSync(skillFile).isFile()) continue;
      const content = readFileSync(skillFile, "utf8");
      results.push({
        label: `${entry}/SKILL.md`,
        tokens: estimateTokens(content),
        path: skillFile,
      });
    } catch {
      // skip missing SKILL.md
    }
  }
  return results;
}

// Scan .github/extensions for extension files
export function scanExtensions(root) {
  const dir = join(root, ".github", "extensions");
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const extFile = join(dir, entry, "extension.mjs");
    try {
      if (!statSync(extFile).isFile()) continue;
      const content = readFileSync(extFile, "utf8");
      results.push({
        label: entry,
        tokens: estimateTokens(content),
        path: extFile,
      });
    } catch {
      // skip
    }
  }
  // Also pick up support files (rules.mjs, etc.) in each extension dir
  try {
    for (const entry of entries) {
      const extDir = join(dir, entry);
      if (!statSync(extDir).isDirectory()) continue;
      for (const file of readdirSync(extDir)) {
        if (file === "extension.mjs") continue;
        const fullPath = join(extDir, file);
        try {
          if (!statSync(fullPath).isFile()) continue;
          const content = readFileSync(fullPath, "utf8");
          results.push({
            label: `${entry}/${file}`,
            tokens: estimateTokens(content),
            path: fullPath,
          });
        } catch {
          // skip
        }
      }
    }
  } catch {
    // skip
  }
  return results;
}

// Scan .github/copilot-instructions.md
export function scanStartupContext(root) {
  const results = [];
  const instrPath = join(root, ".github", "copilot-instructions.md");
  try {
    const content = readFileSync(instrPath, "utf8");
    results.push({
      label: "copilot-instructions.md",
      tokens: estimateTokens(content),
      path: instrPath,
    });
  } catch {
    // file may not exist
  }
  return results;
}

function pad(str, len) {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function formatTokens(n) {
  return `~${n.toLocaleString("en-US")} tokens`;
}

// Generate the full report string.
export function generateReport(root) {
  const startup = scanStartupContext(root);
  const agents = scanAgents(root);
  const skills = scanSkills(root);
  const extensions = scanExtensions(root);

  // Sort each group by tokens descending
  agents.sort((a, b) => b.tokens - a.tokens);
  skills.sort((a, b) => b.tokens - a.tokens);
  extensions.sort((a, b) => b.tokens - a.tokens);

  const COL = 40;
  const lines = [];

  lines.push("=== OMCC Token Analytics ===");
  lines.push("");

  // Startup context
  lines.push("Startup Context (always loaded):");
  for (const item of startup) {
    lines.push(`  ${pad(item.label, COL)}${formatTokens(item.tokens)}`);
  }
  lines.push("");

  // Agents
  const agentTotal = agents.reduce((sum, a) => sum + a.tokens, 0);
  lines.push("Agents (loaded when invoked):");
  for (const item of agents) {
    lines.push(`  ${pad(item.label, COL)}${formatTokens(item.tokens)}`);
  }
  lines.push(`  ${pad("TOTAL agents:", COL)}${formatTokens(agentTotal)} (${agents.length} files)`);
  lines.push("");

  // Skills
  const skillTotal = skills.reduce((sum, s) => sum + s.tokens, 0);
  lines.push("Skills (loaded when matched):");
  for (const item of skills) {
    lines.push(`  ${pad(item.label, COL)}${formatTokens(item.tokens)}`);
  }
  lines.push(`  ${pad("TOTAL skills:", COL)}${formatTokens(skillTotal)} (${skills.length} files)`);
  lines.push("");

  // Extensions
  const extTotal = extensions.reduce((sum, e) => sum + e.tokens, 0);
  lines.push("Extensions:");
  for (const item of extensions) {
    lines.push(`  ${pad(item.label, COL)}${formatTokens(item.tokens)}`);
  }
  lines.push(`  ${pad("TOTAL extensions:", COL)}${formatTokens(extTotal)} (${extensions.length} files)`);
  lines.push("");

  // Summary
  const startupTotal = startup.reduce((sum, s) => sum + s.tokens, 0);
  const grandTotal = startupTotal + agentTotal + skillTotal + extTotal;

  lines.push("=== Summary ===");
  lines.push(`${pad("Total harness footprint:", COL + 2)}${formatTokens(grandTotal)}`);
  lines.push("");

  // Top 5 largest files across all categories
  const all = [...startup, ...agents, ...skills, ...extensions].sort(
    (a, b) => b.tokens - a.tokens,
  );
  const top5 = all.slice(0, 5);
  lines.push("Largest 5 files (trim candidates):");
  top5.forEach((item, i) => {
    lines.push(`  ${i + 1}. ${pad(item.label, COL - 3)}${item.tokens.toLocaleString("en-US")} tokens`);
  });
  lines.push("");

  // Recommendation
  const overThreshold = all.filter((f) => f.tokens > TRIM_THRESHOLD);
  if (overThreshold.length > 0) {
    lines.push(
      `Recommendation: ${overThreshold.length} file(s) over ${TRIM_THRESHOLD.toLocaleString("en-US")} tokens should be reviewed for trimming.`,
    );
  } else {
    lines.push(
      `Recommendation: All files are under ${TRIM_THRESHOLD.toLocaleString("en-US")} tokens. Harness is lean.`,
    );
  }

  return lines.join("\n");
}

// Run when executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("analyze-tokens.mjs") ||
    process.argv[1].endsWith("analyze-tokens"));

if (isMain) {
  console.log(generateReport(ROOT));
}
