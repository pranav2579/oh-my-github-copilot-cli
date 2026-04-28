import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  computeFitnessScore,
  scanFiles,
  DEBUG_PATTERNS,
  TODO_PATTERNS,
  SECRET_PATTERNS,
  type FitnessInput,
} from "../src/fitness.js";

function makeTmpDir(): string {
  const name = `fitness-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmpDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("computeFitnessScore", () => {
  it("returns perfect score when all components pass", () => {
    const input: FitnessInput = {
      build_cmd: "npm run build",
      build_exit_code: 0,
      lint_cmd: "npm run lint",
      lint_exit_code: 0,
      test_cmd: "npm test",
      test_exit_code: 0,
      test_passed: 20,
      test_total: 20,
      format_cmd: "npm run format:check",
      format_exit_code: 0,
      changed_files: [],
    };
    const result = computeFitnessScore(input);
    expect(result.score).toBe(1.0);
    expect(result.grade).toBe("PASS");
    expect(result.components.build_health.score).toBe(1.0);
    expect(result.components.lint_clean.score).toBe(1.0);
    expect(result.components.test_pass.score).toBe(1.0);
    expect(result.components.format_check.score).toBe(1.0);
    expect(result.components.no_debug.score).toBe(1.0);
    expect(result.components.no_todos.score).toBe(1.0);
    expect(result.components.security.score).toBe(1.0);
  });

  it("returns neutral (0.5) scores for unconfigured commands", () => {
    const result = computeFitnessScore({});
    expect(result.components.build_health.score).toBe(0.5);
    expect(result.components.lint_clean.score).toBe(0.5);
    expect(result.components.test_pass.score).toBe(0.5);
    expect(result.components.format_check.score).toBe(0.5);
    expect(result.components.build_health.detail).toContain("not configured");
    expect(result.components.no_debug.score).toBe(1.0);
    expect(result.components.no_todos.score).toBe(1.0);
    expect(result.components.security.score).toBe(1.0);
  });

  it("returns neutral (0.5) for configured but unexecuted commands", () => {
    const result = computeFitnessScore({
      build_cmd: "npm run build",
      lint_cmd: "npm run lint",
      test_cmd: "npm test",
      format_cmd: "npm run format:check",
    });
    expect(result.components.build_health.score).toBe(0.5);
    expect(result.components.build_health.detail).toContain("not yet executed");
  });

  it("computes weighted score with mixed results", () => {
    const input: FitnessInput = {
      build_cmd: "npm run build",
      build_exit_code: 0,
      lint_cmd: "npm run lint",
      lint_exit_code: 1,
      test_cmd: "npm test",
      test_exit_code: 0,
      test_passed: 18,
      test_total: 20,
      format_cmd: "fmt",
      format_exit_code: 0,
      changed_files: [],
    };
    const result = computeFitnessScore(input);
    expect(result.score).toBeCloseTo(0.78, 1);
    expect(result.grade).toBe("PASS");
  });

  it("returns REJECT for very low scores", () => {
    const result = computeFitnessScore({
      build_cmd: "build", build_exit_code: 1,
      lint_cmd: "lint", lint_exit_code: 1,
      test_cmd: "test", test_exit_code: 1, test_passed: 0, test_total: 20,
      format_cmd: "fmt", format_exit_code: 1,
      changed_files: [],
    });
    expect(result.score).toBe(0.25);
    expect(result.grade).toBe("REJECT");
  });

  it("returns WARN for borderline scores", () => {
    const result = computeFitnessScore({
      build_cmd: "b", build_exit_code: 0,
      lint_cmd: "l", lint_exit_code: 1,
      test_cmd: "t", test_exit_code: 0,
      format_cmd: "f", format_exit_code: 1,
      changed_files: [],
    });
    expect(result.score).toBe(0.70);
    expect(result.grade).toBe("WARN");
  });
});

describe("grade thresholds", () => {
  it("REJECT when all commands fail", () => {
    const result = computeFitnessScore({
      build_cmd: "b", build_exit_code: 1,
      lint_cmd: "l", lint_exit_code: 1,
      test_cmd: "t", test_exit_code: 1,
      format_cmd: "f", format_exit_code: 1,
      changed_files: [],
    });
    expect(result.grade).toBe("REJECT");
  });

  it("PASS when all commands succeed", () => {
    const result = computeFitnessScore({
      build_cmd: "b", build_exit_code: 0,
      lint_cmd: "l", lint_exit_code: 0,
      test_cmd: "t", test_exit_code: 0,
      format_cmd: "f", format_exit_code: 0,
      changed_files: [],
    });
    expect(result.grade).toBe("PASS");
  });

  it("boundary: score exactly 0.70 is WARN", () => {
    const result = computeFitnessScore({
      build_cmd: "b", build_exit_code: 0,
      lint_cmd: "l", lint_exit_code: 1,
      test_cmd: "t", test_exit_code: 0,
      format_cmd: "f", format_exit_code: 1,
      changed_files: [],
    });
    expect(result.score).toBe(0.70);
    expect(result.grade).toBe("WARN");
  });
});

describe("debug artifact detection", () => {
  it("detects console.log in files", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "a.ts"), 'console.log("debug");\n');
    writeFileSync(join(dir, "b.ts"), "const x = 1;\n");
    const result = computeFitnessScore({ project_root: dir, changed_files: ["a.ts", "b.ts"] });
    expect(result.components.no_debug.score).toBeLessThan(1.0);
    expect(result.components.no_debug.detail).toContain("debug artifacts");
    cleanTmpDir(dir);
  });

  it("detects debugger statement", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "x.js"), "function f() { debugger; return 1; }\n");
    const { matchCount } = scanFiles(["x.js"], dir, DEBUG_PATTERNS);
    expect(matchCount).toBe(1);
    cleanTmpDir(dir);
  });

  it("detects Debug.WriteLine", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "x.cs"), 'Debug.WriteLine("test");\n');
    const { matchCount } = scanFiles(["x.cs"], dir, DEBUG_PATTERNS);
    expect(matchCount).toBe(1);
    cleanTmpDir(dir);
  });

  it("clean files get perfect debug score", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "clean.ts"), "export const x = 42;\n");
    const result = computeFitnessScore({ project_root: dir, changed_files: ["clean.ts"] });
    expect(result.components.no_debug.score).toBe(1.0);
    cleanTmpDir(dir);
  });
});

describe("TODO detection", () => {
  it("detects TODO in files", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "a.ts"), "// TODO: fix this later\n");
    writeFileSync(join(dir, "b.ts"), "const x = 1;\n");
    const result = computeFitnessScore({ project_root: dir, changed_files: ["a.ts", "b.ts"] });
    expect(result.components.no_todos.score).toBeLessThan(1.0);
    cleanTmpDir(dir);
  });

  it("detects FIXME and HACK", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "a.ts"), "// FIXME: broken\n");
    writeFileSync(join(dir, "b.ts"), "// HACK: workaround\n");
    const { matchCount } = scanFiles(["a.ts", "b.ts"], dir, TODO_PATTERNS);
    expect(matchCount).toBe(2);
    cleanTmpDir(dir);
  });

  it("detects XXX marker", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "c.ts"), "// XXX: temporary\n");
    const { matchCount } = scanFiles(["c.ts"], dir, TODO_PATTERNS);
    expect(matchCount).toBe(1);
    cleanTmpDir(dir);
  });
});

describe("security pattern detection", () => {
  it("detects API_KEY assignments", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "config.ts"), 'const API_KEY = "sk-1234";\n');
    const { matchCount } = scanFiles(["config.ts"], dir, SECRET_PATTERNS);
    expect(matchCount).toBe(1);
    cleanTmpDir(dir);
  });

  it("detects GitHub tokens", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "env.ts"), 'const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";\n');
    const { matchCount } = scanFiles(["env.ts"], dir, SECRET_PATTERNS);
    expect(matchCount).toBe(1);
    cleanTmpDir(dir);
  });

  it("security violations zero the component", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "bad.ts"), 'PASSWORD = "hunter2"\n');
    const result = computeFitnessScore({ project_root: dir, changed_files: ["bad.ts"] });
    expect(result.components.security.score).toBe(0.0);
    cleanTmpDir(dir);
  });

  it("clean files pass security", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "ok.ts"), "export function hash(input: string) { return input; }\n");
    const result = computeFitnessScore({ project_root: dir, changed_files: ["ok.ts"] });
    expect(result.components.security.score).toBe(1.0);
    cleanTmpDir(dir);
  });
});

describe("test pass ratio", () => {
  it("computes ratio from passed/total", () => {
    const result = computeFitnessScore({
      test_cmd: "npm test", test_exit_code: 1, test_passed: 19, test_total: 20, changed_files: [],
    });
    expect(result.components.test_pass.score).toBeCloseTo(0.95, 2);
    expect(result.components.test_pass.detail).toBe("19/20 tests passed");
  });

  it("uses exit code when pass/total not provided", () => {
    const pass = computeFitnessScore({ test_cmd: "npm test", test_exit_code: 0, changed_files: [] });
    expect(pass.components.test_pass.score).toBe(1.0);
    const fail = computeFitnessScore({ test_cmd: "npm test", test_exit_code: 1, changed_files: [] });
    expect(fail.components.test_pass.score).toBe(0.0);
  });
});

describe("scanFiles", () => {
  it("skips non-existent files gracefully", () => {
    const dir = makeTmpDir();
    const { matchCount } = scanFiles(["nonexistent.ts"], dir, DEBUG_PATTERNS);
    expect(matchCount).toBe(0);
    cleanTmpDir(dir);
  });

  it("counts at most one match per file", () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "multi.ts"), 'console.log("a");\nconsole.log("b");\ndebugger;\n');
    const { matchCount } = scanFiles(["multi.ts"], dir, DEBUG_PATTERNS);
    expect(matchCount).toBe(1);
    cleanTmpDir(dir);
  });
});

describe("result structure", () => {
  it("includes all required fields", () => {
    const result = computeFitnessScore({});
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("grade");
    expect(result).toHaveProperty("components");
    expect(result).toHaveProperty("recommendation");

    const componentKeys = Object.keys(result.components);
    expect(componentKeys).toContain("build_health");
    expect(componentKeys).toContain("lint_clean");
    expect(componentKeys).toContain("test_pass");
    expect(componentKeys).toContain("no_debug");
    expect(componentKeys).toContain("format_check");
    expect(componentKeys).toContain("no_todos");
    expect(componentKeys).toContain("security");

    for (const key of componentKeys) {
      const comp = result.components[key as keyof typeof result.components];
      expect(comp).toHaveProperty("score");
      expect(comp).toHaveProperty("weight");
      expect(comp).toHaveProperty("detail");
      expect(comp.score).toBeGreaterThanOrEqual(0);
      expect(comp.score).toBeLessThanOrEqual(1);
    }
  });

  it("weights sum to 1.0", () => {
    const result = computeFitnessScore({});
    let totalWeight = 0;
    for (const comp of Object.values(result.components)) {
      totalWeight += comp.weight;
    }
    expect(totalWeight).toBeCloseTo(1.0, 10);
  });
});