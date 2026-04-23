// OMCC Auto-inject Skills extension.
import { joinSession } from "@github/copilot-sdk/extension";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    fm[kv[1]] = v;
  }
  return { fm, body: text.slice(m[0].length) };
}

function loadSkillsFrom(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const skillFile = join(dir, name, "SKILL.md");
    try {
      if (!statSync(skillFile).isFile()) continue;
      const text = readFileSync(skillFile, "utf8");
      const { fm, body } = parseFrontmatter(text);
      const triggers = (fm.triggers ?? fm.trigger ?? "")
        .split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (triggers.length === 0) continue;
      out.push({ name: fm.name ?? name, triggers, body, source: skillFile });
    } catch { /* skip */ }
  }
  return out;
}

function loadAllSkills(cwd) {
  return [
    ...loadSkillsFrom(join(homedir(), ".copilot", "skills")),
    ...loadSkillsFrom(join(cwd, ".github", "skills")),
  ];
}

function bestMatch(skills, prompt) {
  const p = (prompt ?? "").toLowerCase();
  let best = null, bestScore = 0;
  for (const s of skills) {
    let score = 0;
    for (const t of s.triggers) if (t.length > 1 && p.includes(t)) score += 1;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

await joinSession({
  hooks: {
    onUserPromptSubmitted: (input) => {
      const skills = loadAllSkills(input.cwd);
      const match = bestMatch(skills, input.prompt);
      if (!match) return;
      return {
        additionalContext: `# OMCC: auto-injected skill — ${match.name}\n# (matched on triggers; source: ${match.source})\n\n${match.body}`,
      };
    },
  },
});
