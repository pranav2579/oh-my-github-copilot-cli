// OMCC Direction Guard extension.
// On session start, checks for project-brief.md and parses Goals / Non-Goals
// to provide direction-awareness for the session.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function parseProjectBrief(content) {
  const goals = [];
  const nonGoals = [];
  const lines = content.split(/\r?\n/);
  let currentSection = null;

  for (const line of lines) {
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      const heading = headingMatch[1].trim().toLowerCase();
      if (heading === "non-goals" || heading === "non goals") {
        currentSection = "nonGoals";
      } else if (heading === "goals") {
        currentSection = "goals";
      } else {
        currentSection = null;
      }
      continue;
    }
    if (currentSection) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
      if (bulletMatch) {
        const item = bulletMatch[1].trim();
        if (currentSection === "goals") goals.push(item);
        else nonGoals.push(item);
      }
    }
  }
  return { goals, nonGoals };
}

export function loadProjectBrief(cwd) {
  const candidates = [
    join(cwd, "project-brief.md"),
    join(cwd, "memory-bank", "projectbrief.md"),
    join(cwd, "memory-bank", "project-brief.md"),
    join(cwd, "docs", "project-brief.md"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, "utf8");
      return { path: candidate, ...parseProjectBrief(content) };
    }
  }
  return null;
}
