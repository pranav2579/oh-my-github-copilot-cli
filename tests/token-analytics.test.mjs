import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  estimateTokens,
  scanAgents,
  scanSkills,
  scanExtensions,
  scanStartupContext,
  generateReport,
} from "../scripts/analyze-tokens.mjs";

/* ------------------------------------------------------------------ */
/*  Unit tests for token estimation                                    */
/* ------------------------------------------------------------------ */

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("counts words and multiplies by 1.3", () => {
    // "hello world" = 2 words => 2 * 1.3 = 2.6 => rounded to 3
    expect(estimateTokens("hello world")).toBe(Math.round(2 * 1.3));
  });

  it("handles multi-line content with code", () => {
    const text = "function foo() {\n  return bar;\n}\n";
    const words = text.split(/\s+/).filter(Boolean).length;
    expect(estimateTokens(text)).toBe(Math.round(words * 1.3));
  });

  it("handles whitespace-only input", () => {
    expect(estimateTokens("   \n\t  ")).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Integration tests with temp fixtures                               */
/* ------------------------------------------------------------------ */

let tmp;

function setupFixtures() {
  tmp = mkdtempSync(join(tmpdir(), "omcc-tokens-"));

  // agents
  const agentsDir = join(tmp, ".github", "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(agentsDir, "alpha.agent.md"),
    "---\nname: alpha\ndescription: test agent\n---\n\nAlpha agent with some content here for testing.\n",
  );
  writeFileSync(
    join(agentsDir, "beta.agent.md"),
    "---\nname: beta\ndescription: another agent\n---\n\nBeta agent. This one has more words so it should rank higher in the report output for comparison purposes and testing the sort order.\n",
  );
  // non-agent file should be ignored
  writeFileSync(join(agentsDir, "README.md"), "not an agent");

  // skills
  const skillDir1 = join(tmp, ".github", "skills", "skill-one");
  const skillDir2 = join(tmp, ".github", "skills", "skill-two");
  mkdirSync(skillDir1, { recursive: true });
  mkdirSync(skillDir2, { recursive: true });
  writeFileSync(
    join(skillDir1, "SKILL.md"),
    "---\nname: skill-one\ndescription: first skill\n---\n\nSkill one content.\n",
  );
  writeFileSync(
    join(skillDir2, "SKILL.md"),
    "---\nname: skill-two\ndescription: second skill\n---\n\nSkill two with extra words for testing purposes to make it larger.\n",
  );

  // extensions
  const extDir = join(tmp, ".github", "extensions", "my-ext");
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, "extension.mjs"),
    "// extension code\nconsole.log('hello');\n",
  );

  // copilot-instructions.md
  writeFileSync(
    join(tmp, ".github", "copilot-instructions.md"),
    "# Instructions\n\nSome startup instructions for the session.\n",
  );
}

function teardownFixtures() {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

describe("scanAgents", () => {
  it("finds only .agent.md files", () => {
    setupFixtures();
    try {
      const agents = scanAgents(tmp);
      expect(agents.length).toBe(2);
      const labels = agents.map((a) => a.label);
      expect(labels).toContain("alpha.agent.md");
      expect(labels).toContain("beta.agent.md");
      // README.md should not be included
      expect(labels).not.toContain("README.md");
    } finally {
      teardownFixtures();
    }
  });

  it("returns empty array when agents dir is missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "omcc-no-agents-"));
    try {
      expect(scanAgents(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("each agent has a positive token count", () => {
    setupFixtures();
    try {
      const agents = scanAgents(tmp);
      for (const a of agents) {
        expect(a.tokens).toBeGreaterThan(0);
      }
    } finally {
      teardownFixtures();
    }
  });
});

describe("scanSkills", () => {
  it("finds SKILL.md in each skill subdirectory", () => {
    setupFixtures();
    try {
      const skills = scanSkills(tmp);
      expect(skills.length).toBe(2);
      const labels = skills.map((s) => s.label);
      expect(labels).toContain("skill-one/SKILL.md");
      expect(labels).toContain("skill-two/SKILL.md");
    } finally {
      teardownFixtures();
    }
  });

  it("returns empty array when skills dir is missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "omcc-no-skills-"));
    try {
      expect(scanSkills(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("scanExtensions", () => {
  it("finds extension.mjs files", () => {
    setupFixtures();
    try {
      const exts = scanExtensions(tmp);
      const mainExt = exts.find((e) => e.label === "my-ext");
      expect(mainExt).toBeDefined();
      expect(mainExt.tokens).toBeGreaterThan(0);
    } finally {
      teardownFixtures();
    }
  });
});

describe("scanStartupContext", () => {
  it("finds copilot-instructions.md", () => {
    setupFixtures();
    try {
      const startup = scanStartupContext(tmp);
      expect(startup.length).toBe(1);
      expect(startup[0].label).toBe("copilot-instructions.md");
      expect(startup[0].tokens).toBeGreaterThan(0);
    } finally {
      teardownFixtures();
    }
  });
});

describe("generateReport", () => {
  it("includes all expected sections", () => {
    setupFixtures();
    try {
      const report = generateReport(tmp);
      expect(report).toContain("=== OMCC Token Analytics ===");
      expect(report).toContain("Startup Context (always loaded):");
      expect(report).toContain("Agents (loaded when invoked):");
      expect(report).toContain("Skills (loaded when matched):");
      expect(report).toContain("Extensions:");
      expect(report).toContain("=== Summary ===");
      expect(report).toContain("Total harness footprint:");
      expect(report).toContain("Largest 5 files (trim candidates):");
      expect(report).toContain("Recommendation:");
    } finally {
      teardownFixtures();
    }
  });

  it("sorts agents by token count descending", () => {
    setupFixtures();
    try {
      const report = generateReport(tmp);
      const agentSection = report.split("Agents (loaded when invoked):")[1].split("TOTAL agents:")[0];
      const alphaIdx = agentSection.indexOf("alpha.agent.md");
      const betaIdx = agentSection.indexOf("beta.agent.md");
      // beta has more content, so it should appear first
      expect(betaIdx).toBeLessThan(alphaIdx);
    } finally {
      teardownFixtures();
    }
  });

  it("includes total counts for each section", () => {
    setupFixtures();
    try {
      const report = generateReport(tmp);
      expect(report).toMatch(/TOTAL agents:.*tokens \(2 files\)/);
      expect(report).toMatch(/TOTAL skills:.*tokens \(2 files\)/);
      expect(report).toMatch(/TOTAL extensions:.*tokens \(1 files?\)/);
    } finally {
      teardownFixtures();
    }
  });

  it("runs without errors on the real repository", () => {
    const report = generateReport(process.cwd());
    expect(report).toContain("=== OMCC Token Analytics ===");
    expect(report).toContain("=== Summary ===");
    expect(report).toContain("TOTAL agents:");
    expect(report).toContain("TOTAL skills:");
  });
});
