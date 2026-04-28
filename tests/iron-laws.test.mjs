import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectDebugArtifacts,
  extractFilePath,
  isFormatCommand,
  isGitCommitCommand,
  isTestFile,
  updateCircuitBreaker,
} from "../.github/extensions/omcc-iron-laws/rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lawsPath = join(__dirname, "../.github/extensions/omcc-iron-laws/laws.json");

// ---------- Module shape ----------

describe("iron-laws module exports", () => {
  it("exports all expected detection functions", () => {
    expect(typeof detectDebugArtifacts).toBe("function");
    expect(typeof extractFilePath).toBe("function");
    expect(typeof isFormatCommand).toBe("function");
    expect(typeof isGitCommitCommand).toBe("function");
    expect(typeof isTestFile).toBe("function");
    expect(typeof updateCircuitBreaker).toBe("function");
  });
});

// ---------- Law configuration ----------

describe("laws.json configuration", () => {
  const laws = JSON.parse(readFileSync(lawsPath, "utf8"));

  it("contains all four laws", () => {
    expect(laws).toHaveProperty("read-before-write");
    expect(laws).toHaveProperty("no-debug-artifacts");
    expect(laws).toHaveProperty("circuit-breaker");
    expect(laws).toHaveProperty("format-before-commit");
  });

  it("each law has enabled and severity", () => {
    for (const key of Object.keys(laws)) {
      expect(laws[key]).toHaveProperty("enabled");
      expect(laws[key]).toHaveProperty("severity");
    }
  });

  it("circuit-breaker has a threshold", () => {
    expect(laws["circuit-breaker"].threshold).toBe(3);
  });
});

// ---------- Law 2: debug artifact detection ----------

describe("detectDebugArtifacts", () => {
  it("detects console.log", () => {
    const hits = detectDebugArtifacts('console.log("hello");', "src/app.js");
    expect(hits).toContain("console.log");
  });

  it("detects console.debug", () => {
    const hits = detectDebugArtifacts('console.debug("x");', "src/app.ts");
    expect(hits).toContain("console.debug");
  });

  it("detects Debug.WriteLine", () => {
    const hits = detectDebugArtifacts('Debug.WriteLine("test");', "Program.cs");
    expect(hits).toContain("Debug.WriteLine");
  });

  it("detects debugger statement", () => {
    const hits = detectDebugArtifacts("debugger;", "src/util.js");
    expect(hits).toContain("debugger statement");
  });

  it("detects print() only in .py files", () => {
    expect(detectDebugArtifacts('print("hi")', "main.py")).toContain("print()");
    expect(detectDebugArtifacts('print("hi")', "main.js")).not.toContain("print()");
  });

  it("returns empty array for clean code", () => {
    expect(detectDebugArtifacts("const x = 42;", "src/app.ts")).toEqual([]);
  });

  it("returns empty array for null/undefined content", () => {
    expect(detectDebugArtifacts(null, "src/app.ts")).toEqual([]);
    expect(detectDebugArtifacts(undefined, "src/app.ts")).toEqual([]);
  });

  it("can detect multiple artifacts at once", () => {
    const code = 'console.log("a"); debugger; console.debug("b");';
    const hits = detectDebugArtifacts(code, "src/app.js");
    expect(hits).toContain("console.log");
    expect(hits).toContain("console.debug");
    expect(hits).toContain("debugger statement");
    expect(hits).toHaveLength(3);
  });
});

// ---------- isTestFile ----------

describe("isTestFile", () => {
  it.each([
    "src/utils.test.ts",
    "src/utils.spec.js",
    "__tests__/foo.js",
    "tests/bar.mjs",
    "spec/helper.ts",
    "src/Component.stories.tsx",
    "lib/core_test.py",
  ])("recognizes %s as a test file", (p) => {
    expect(isTestFile(p)).toBe(true);
  });

  it.each([
    "src/index.ts",
    "README.md",
    "lib/utils.js",
    "Program.cs",
  ])("does not flag %s as a test file", (p) => {
    expect(isTestFile(p)).toBe(false);
  });

  it("returns false for falsy input", () => {
    expect(isTestFile("")).toBe(false);
    expect(isTestFile(null)).toBe(false);
    expect(isTestFile(undefined)).toBe(false);
  });
});

// ---------- extractFilePath ----------

describe("extractFilePath", () => {
  it("extracts path from toolArgs.path", () => {
    expect(extractFilePath({ path: "/a/b.ts" })).toBe("/a/b.ts");
  });
  it("extracts path from toolArgs.file_path", () => {
    expect(extractFilePath({ file_path: "/c/d.ts" })).toBe("/c/d.ts");
  });
  it("extracts path from toolArgs.filePath", () => {
    expect(extractFilePath({ filePath: "/e/f.ts" })).toBe("/e/f.ts");
  });
  it("returns empty string for missing args", () => {
    expect(extractFilePath({})).toBe("");
    expect(extractFilePath(undefined)).toBe("");
  });
});

// ---------- Git commit / format detection ----------

describe("isGitCommitCommand", () => {
  it.each([
    "git commit -m 'msg'",
    "git commit --amend",
    "git add . && git commit -m 'test'",
  ])("detects git commit in: %s", (cmd) => {
    expect(isGitCommitCommand(cmd)).toBe(true);
  });

  it.each([
    "git status",
    "git push origin main",
    "git log",
  ])("does not flag: %s", (cmd) => {
    expect(isGitCommitCommand(cmd)).toBe(false);
  });
});

describe("isFormatCommand", () => {
  it.each([
    "npx prettier --write .",
    "pnpm format:fix",
    "npm run format",
    "npm run lint",
    "eslint --fix .",
    "dotnet format",
    "biome check --apply .",
    "dprint fmt",
  ])("detects format/lint in: %s", (cmd) => {
    expect(isFormatCommand(cmd)).toBe(true);
  });

  it.each([
    "npm test",
    "git status",
    "node index.js",
  ])("does not flag: %s", (cmd) => {
    expect(isFormatCommand(cmd)).toBe(false);
  });
});

// ---------- Law 3: circuit breaker ----------

describe("updateCircuitBreaker", () => {
  it("increments on failure", () => {
    expect(updateCircuitBreaker(false, 0)).toBe(1);
    expect(updateCircuitBreaker(false, 2)).toBe(3);
  });

  it("resets on success", () => {
    expect(updateCircuitBreaker(true, 5)).toBe(0);
    expect(updateCircuitBreaker(true, 0)).toBe(0);
  });

  it("reaches threshold after consecutive failures", () => {
    let count = 0;
    count = updateCircuitBreaker(false, count); // 1
    count = updateCircuitBreaker(false, count); // 2
    count = updateCircuitBreaker(false, count); // 3
    expect(count).toBe(3);
    expect(count >= 3).toBe(true);
  });

  it("resets mid-streak on success", () => {
    let count = 0;
    count = updateCircuitBreaker(false, count); // 1
    count = updateCircuitBreaker(false, count); // 2
    count = updateCircuitBreaker(true, count);  // 0
    count = updateCircuitBreaker(false, count); // 1
    expect(count).toBe(1);
  });
});
