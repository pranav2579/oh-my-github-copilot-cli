#!/usr/bin/env node
// scripts/port-from-omc.mjs
// Port agents and skills from oh-my-claudecode (MIT) to OMCC.
// Verbatim copy + branding-only find/replace. Tool-reference adaptation is Phase 2.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, copyFileSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { execSync } from "node:child_process";

const OMC_SRC = process.env.OMC_SRC || "/tmp/omc-source";
const DEST = process.env.DEST || join(process.cwd());

const RENAMES = {
  // slash-command collisions with Copilot CLI built-ins
  "plan": "omcc-plan",
  "setup": "omcc-setup",
  // legacy omc- prefix → omcc-
  "omc-doctor": "omcc-doctor",
  "omc-reference": "omcc-reference",
  "omc-setup": "omcc-setup-legacy",
  "omc-teams": "omcc-teams",
};

const TEXT_REPLACEMENTS = [
  // Branding (case-sensitive, ordered most-specific first)
  ["oh-my-claudecode", "oh-my-github-copilot-cli"],
  ["Yeachan-Heo/oh-my-claudecode", "pranav2579/oh-my-github-copilot-cli"],
  ["Yeachan Heo", "Pranav Tripathi"],
  // Don't blindly map "Claude Code" → "Copilot CLI" because it would corrupt
  // sentences. Phase 2 does the per-prompt adaptation.
  // But we DO swap the obvious config-path references:
  [/\.omc\b/g, ".omcc"],
  [/\bomc-/g, "omcc-"],
  [/\bOMC\b/g, "OMCC"],
];

function applyTextReplacements(s) {
  for (const [from, to] of TEXT_REPLACEMENTS) {
    s = s.replaceAll ? (typeof from === "string" ? s.replaceAll(from, to) : s.replace(from, to)) : s.replace(from, to);
  }
  return s;
}

function getOmcSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: OMC_SRC }).toString().trim();
  } catch {
    return "unknown";
  }
}

function ensureDir(d) {
  mkdirSync(d, { recursive: true });
}

const PROVENANCE = [];

function portAgent(srcFile, destDir, originalName) {
  const newName = RENAMES[originalName] ?? originalName;
  const content = readFileSync(srcFile, "utf8");
  const ported = applyTextReplacements(content);
  // Adapt the frontmatter `name:` field if renamed
  const adapted = newName !== originalName
    ? ported.replace(/^name:\s*[\w-]+\s*$/m, `name: ${newName}`)
    : ported;
  // Write as <name>.agent.md (Copilot CLI convention; OMC uses bare <name>.md)
  const destFile = join(destDir, `${newName}.agent.md`);
  // Don't overwrite Phase-0 personal seeds; instead suffix with .omc.agent.md
  if (existsSync(destFile)) {
    const altDest = join(destDir, `${newName}.omc.agent.md`);
    writeFileSync(altDest, adapted);
    PROVENANCE.push({ kind: "agent", original: originalName, new: `${newName}.omc`, src: `agents/${originalName}.md`, note: "renamed to .omc.agent.md to avoid clobbering Phase-0 personal seed" });
  } else {
    writeFileSync(destFile, adapted);
    PROVENANCE.push({ kind: "agent", original: originalName, new: newName, src: `agents/${originalName}.md` });
  }
}

function portSkill(srcDir, destBase, originalName) {
  const newName = RENAMES[originalName] ?? originalName;
  const skillDir = join(destBase, newName);
  ensureDir(skillDir);
  // Copy SKILL.md (and any other files in the skill dir) with replacements applied to .md files
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const destPath = join(skillDir, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) continue; // nested dirs are rare; skip
    if (entry.endsWith(".md")) {
      let content = readFileSync(srcPath, "utf8");
      content = applyTextReplacements(content);
      if (entry === "SKILL.md" && newName !== originalName) {
        content = content.replace(/^name:\s*[\w-]+\s*$/m, `name: ${newName}`);
      }
      writeFileSync(destPath, content);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
  PROVENANCE.push({ kind: "skill", original: originalName, new: newName, src: `skills/${originalName}/` });
}

function main() {
  const sha = getOmcSha();
  console.log(`Porting from oh-my-claudecode @ ${sha}`);

  // Agents
  const agentsSrc = join(OMC_SRC, "agents");
  const agentsDst = join(DEST, ".github", "agents");
  ensureDir(agentsDst);
  for (const f of readdirSync(agentsSrc)) {
    if (!f.endsWith(".md")) continue;
    if (f === "AGENTS.md") continue;
    const name = f.replace(/\.md$/, "");
    portAgent(join(agentsSrc, f), agentsDst, name);
  }

  // Skills
  const skillsSrc = join(OMC_SRC, "skills");
  const skillsDst = join(DEST, ".github", "skills");
  ensureDir(skillsDst);
  for (const entry of readdirSync(skillsSrc)) {
    const p = join(skillsSrc, entry);
    if (!statSync(p).isDirectory()) continue;
    if (!existsSync(join(p, "SKILL.md"))) continue;
    portSkill(p, skillsDst, entry);
  }

  // Provenance
  const provPath = join(DEST, "docs", "ATTRIBUTION.md");
  ensureDir(dirname(provPath));
  const lines = [
    "# ATTRIBUTION",
    "",
    "Per-file provenance for content ported into OMCC.",
    "",
    `## oh-my-claudecode @ \`${sha}\``,
    "",
    "Source: https://github.com/Yeachan-Heo/oh-my-claudecode (MIT). License preserved verbatim in [`licenses/oh-my-claudecode.LICENSE`](../licenses/oh-my-claudecode.LICENSE).",
    "",
    "### Agents",
    "",
    "| Original | Ported as | Source path | Note |",
    "|---|---|---|---|",
    ...PROVENANCE.filter(p => p.kind === "agent").map(p =>
      `| \`${p.original}\` | \`${p.new}.agent.md\` | \`${p.src}\` | ${p.note ?? ""} |`),
    "",
    "### Skills",
    "",
    "| Original | Ported as | Source path |",
    "|---|---|---|",
    ...PROVENANCE.filter(p => p.kind === "skill").map(p =>
      `| \`${p.original}\` | \`${p.new}/\` | \`${p.src}\` |`),
    "",
    "## oh-my-githubcopilot",
    "",
    "Design inspiration only. No source text included. See [LICENSE-THIRD-PARTY.md](../LICENSE-THIRD-PARTY.md) for rationale.",
    "",
  ];
  writeFileSync(provPath, lines.join("\n"));
  console.log(`Wrote ${provPath}`);
  console.log(`Ported ${PROVENANCE.filter(p => p.kind === "agent").length} agents, ${PROVENANCE.filter(p => p.kind === "skill").length} skills.`);
}

main();
