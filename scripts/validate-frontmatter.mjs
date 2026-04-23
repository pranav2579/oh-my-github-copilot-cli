#!/usr/bin/env node
// scripts/validate-frontmatter.mjs
// Parses every .agent.md and SKILL.md, asserts required frontmatter, and
// rejects any name matching a Copilot CLI built-in slash command.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = process.cwd();
const ERRORS = [];

// Copilot CLI built-in slash commands (verified via `copilot --help` + /? in-session)
const RESERVED_SLASHES = new Set([
  "plan", "clear", "help", "status", "setup", "exit", "quit",
  "model", "session", "login", "logout", "version", "feedback",
]);

const REQUIRED_AGENT_FIELDS = ["name", "description"];
const REQUIRED_SKILL_FIELDS = ["name", "description"];

function parseFrontmatter(content, file) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    ERRORS.push(`${file}: missing frontmatter`);
    return null;
  }
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(/^([\w-]+):\s*(.*)$/);
    if (km) {
      let v = km[2].trim();
      // Strip surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      fm[km[1]] = v;
    }
  }
  return fm;
}

function checkRequired(fm, file, required) {
  for (const k of required) {
    if (!fm[k] || fm[k].length === 0) {
      ERRORS.push(`${file}: missing or empty required field "${k}"`);
    }
  }
}

function checkCollision(name, file, kind) {
  if (RESERVED_SLASHES.has(name)) {
    ERRORS.push(`${file}: ${kind} name "${name}" collides with Copilot CLI built-in slash command. Prefix with "omcc-".`);
  }
}

const seenAgentNames = new Map();
const seenSkillNames = new Map();

function checkUnique(map, name, file, kind) {
  if (map.has(name)) {
    ERRORS.push(`${file}: duplicate ${kind} name "${name}" (also defined in ${map.get(name)})`);
  } else {
    map.set(name, file);
  }
}

function validateAgentFile(file) {
  const content = readFileSync(file, "utf8");
  const fm = parseFrontmatter(content, file);
  if (!fm) return;
  checkRequired(fm, file, REQUIRED_AGENT_FIELDS);
  if (fm.name) {
    checkCollision(fm.name, file, "agent");
    checkUnique(seenAgentNames, fm.name, file, "agent");
    // sanity: filename should match name
    const expected = basename(file).replace(/\.agent\.md$/, "");
    if (expected !== fm.name) {
      ERRORS.push(`${file}: filename basename "${expected}" doesn't match frontmatter name "${fm.name}"`);
    }
  }
}

function validateSkillFile(file) {
  const content = readFileSync(file, "utf8");
  const fm = parseFrontmatter(content, file);
  if (!fm) return;
  checkRequired(fm, file, REQUIRED_SKILL_FIELDS);
  if (fm.name) {
    checkCollision(fm.name, file, "skill");
    checkUnique(seenSkillNames, fm.name, file, "skill");
  }
}

function walkAgents(dir) {
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".agent.md")) continue;
    validateAgentFile(join(dir, entry));
  }
}

function walkSkills(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (!statSync(p).isDirectory()) continue;
    const skillFile = join(p, "SKILL.md");
    try {
      statSync(skillFile);
    } catch {
      ERRORS.push(`${p}: skill directory missing SKILL.md`);
      continue;
    }
    validateSkillFile(skillFile);
  }
}

walkAgents(join(ROOT, ".github", "agents"));
walkSkills(join(ROOT, ".github", "skills"));

if (ERRORS.length > 0) {
  console.error(`✗ ${ERRORS.length} validation errors:`);
  for (const e of ERRORS) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ All agents and skills validated. Agents: ${seenAgentNames.size}, Skills: ${seenSkillNames.size}.`);
