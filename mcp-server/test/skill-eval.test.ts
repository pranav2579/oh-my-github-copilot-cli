import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type OmccDb } from "../src/db.js";
import {
  createEvalConfig,
  computeScore,
  computeGrade,
  generateReport,
  ensureEvalTables,
  omcc_eval_create,
  omcc_eval_score,
  omcc_eval_report,
  omcc_eval_history,
  type GraderResult,
  type EvalResult,
  type TestCase,
} from "../src/skill-eval.js";

let db: OmccDb;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "eval-test-"));
  db = openDb(join(tmp, "db.sqlite"));
  ensureEvalTables(db);
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// createEvalConfig
// ---------------------------------------------------------------------------

describe("createEvalConfig", () => {
  it("creates config with defaults", () => {
    const cases: TestCase[] = [{ id: "t1", prompt: "do something" }];
    const config = createEvalConfig("my-skill", cases);
    expect(config.skill_name).toBe("my-skill");
    expect(config.test_cases).toHaveLength(1);
    expect(config.trials_per_case).toBe(1);
    expect(config.graders).toHaveLength(1);
    expect(config.graders[0].type).toBe("exit-code");
  });

  it("accepts custom graders and trials_per_case", () => {
    const config = createEvalConfig(
      "s",
      [{ id: "t1", prompt: "p" }],
      [{ type: "contains", weight: 0.5, params: { substring: "ok" } }],
      3,
    );
    expect(config.graders[0].type).toBe("contains");
    expect(config.trials_per_case).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// computeScore
// ---------------------------------------------------------------------------

describe("computeScore", () => {
  it("returns 0 for empty results", () => {
    expect(computeScore([])).toBe(0);
  });

  it("returns 1.0 when all graders pass with equal weight", () => {
    const results: GraderResult[] = [
      { grader_type: "exit-code", passed: true, weight: 1.0 },
      { grader_type: "contains", passed: true, weight: 1.0 },
    ];
    expect(computeScore(results)).toBe(1.0);
  });

  it("returns 0 when all graders fail", () => {
    const results: GraderResult[] = [
      { grader_type: "exit-code", passed: false, weight: 1.0 },
      { grader_type: "contains", passed: false, weight: 1.0 },
    ];
    expect(computeScore(results)).toBe(0);
  });

  it("computes weighted average correctly", () => {
    const results: GraderResult[] = [
      { grader_type: "exit-code", passed: true, weight: 3.0 },
      { grader_type: "contains", passed: false, weight: 1.0 },
    ];
    expect(computeScore(results)).toBe(0.75);
  });

  it("handles single grader", () => {
    expect(computeScore([{ grader_type: "exit-code", passed: true, weight: 1.0 }])).toBe(1.0);
    expect(computeScore([{ grader_type: "exit-code", passed: false, weight: 1.0 }])).toBe(0);
  });

  it("handles zero total weight", () => {
    const results: GraderResult[] = [
      { grader_type: "a", passed: true, weight: 0 },
    ];
    expect(computeScore(results)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeGrade
// ---------------------------------------------------------------------------

describe("computeGrade", () => {
  it("returns A for delta >= 0.30", () => {
    expect(computeGrade(0.30)).toBe("A");
    expect(computeGrade(0.50)).toBe("A");
    expect(computeGrade(1.00)).toBe("A");
  });

  it("returns B for delta >= 0.15 and < 0.30", () => {
    expect(computeGrade(0.15)).toBe("B");
    expect(computeGrade(0.29)).toBe("B");
  });

  it("returns C for delta >= 0.00 and < 0.15", () => {
    expect(computeGrade(0.00)).toBe("C");
    expect(computeGrade(0.14)).toBe("C");
  });

  it("returns F for negative delta", () => {
    expect(computeGrade(-0.01)).toBe("F");
    expect(computeGrade(-0.50)).toBe("F");
    expect(computeGrade(-1.00)).toBe("F");
  });

  it("boundary: exactly 0.30 is A, not B", () => {
    expect(computeGrade(0.30)).toBe("A");
  });

  it("boundary: exactly 0.15 is B, not C", () => {
    expect(computeGrade(0.15)).toBe("B");
  });

  it("boundary: exactly 0.00 is C, not F", () => {
    expect(computeGrade(0.00)).toBe("C");
  });
});

// ---------------------------------------------------------------------------
// generateReport
// ---------------------------------------------------------------------------

describe("generateReport", () => {
  it("generates report with correct structure", () => {
    const result: EvalResult = {
      skill_name: "test-skill",
      with_skill_score: 0.8,
      without_skill_score: 0.5,
      delta: 0.3,
      grade: "A",
      test_results: [
        {
          test_case_id: "tc1",
          with_score: 0.8,
          without_score: 0.5,
          grader_results_with: [],
          grader_results_without: [],
        },
      ],
    };
    const report = generateReport(result);
    expect(report).toContain("# Skill Evaluation Report: test-skill");
    expect(report).toContain("**Grade**: A");
    expect(report).toContain("**With skill**: 0.800");
    expect(report).toContain("**Without skill (baseline)**: 0.500");
    expect(report).toContain("+0.300");
    expect(report).toContain("Skill clearly helps");
    expect(report).toContain("tc1");
  });

  it("shows correct interpretation for each grade", () => {
    const base: EvalResult = {
      skill_name: "s",
      with_skill_score: 0,
      without_skill_score: 0,
      delta: 0,
      grade: "C",
      test_results: [],
    };

    expect(generateReport({ ...base, grade: "A" })).toContain("Keep and promote");
    expect(generateReport({ ...base, grade: "B" })).toContain("consider improving");
    expect(generateReport({ ...base, grade: "C" })).toContain("token cost");
    expect(generateReport({ ...base, grade: "F" })).toContain("fix or remove");
  });

  it("shows negative delta correctly", () => {
    const result: EvalResult = {
      skill_name: "bad-skill",
      with_skill_score: 0.3,
      without_skill_score: 0.7,
      delta: -0.4,
      grade: "F",
      test_results: [],
    };
    const report = generateReport(result);
    expect(report).toContain("-0.400");
  });
});

// ---------------------------------------------------------------------------
// MCP tool: omcc_eval_create
// ---------------------------------------------------------------------------

describe("omcc_eval_create", () => {
  it("creates eval with valid inputs", () => {
    const r = omcc_eval_create(db, {
      skill_name: "my-skill",
      test_cases: JSON.stringify([{ id: "t1", prompt: "test prompt" }]),
      graders: JSON.stringify([{ type: "exit-code", weight: 1.0, params: { expected: "0" } }]),
    });
    expect(r.ok).toBe(true);
    const data = r.data as { eval_id: string };
    expect(data.eval_id).toBeTruthy();
  });

  it("rejects missing skill_name", () => {
    const r = omcc_eval_create(db, { skill_name: "", test_cases: "[]", graders: "[]" });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid JSON", () => {
    const r = omcc_eval_create(db, { skill_name: "s", test_cases: "not json", graders: "[]" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("valid JSON");
  });

  it("rejects empty test_cases array", () => {
    const r = omcc_eval_create(db, {
      skill_name: "s",
      test_cases: "[]",
      graders: JSON.stringify([{ type: "exit-code", weight: 1, params: {} }]),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("non-empty");
  });

  it("rejects empty graders array", () => {
    const r = omcc_eval_create(db, {
      skill_name: "s",
      test_cases: JSON.stringify([{ id: "t1", prompt: "p" }]),
      graders: "[]",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("non-empty");
  });
});

// ---------------------------------------------------------------------------
// MCP tool: omcc_eval_score
// ---------------------------------------------------------------------------

describe("omcc_eval_score", () => {
  function createTestEval(): string {
    const r = omcc_eval_create(db, {
      skill_name: "s",
      test_cases: JSON.stringify([{ id: "t1", prompt: "p" }]),
      graders: JSON.stringify([{ type: "exit-code", weight: 1.0, params: {} }]),
    });
    return (r.data as { eval_id: string }).eval_id;
  }

  it("records score for valid arm", () => {
    const evalId = createTestEval();
    const r = omcc_eval_score(db, {
      eval_id: evalId,
      arm: "with",
      test_case_id: "t1",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: true, weight: 1.0 }]),
    });
    expect(r.ok).toBe(true);
    expect((r.data as { score: number }).score).toBe(1.0);
  });

  it("rejects invalid arm", () => {
    const evalId = createTestEval();
    const r = omcc_eval_score(db, {
      eval_id: evalId,
      arm: "invalid",
      test_case_id: "t1",
      grader_results: "[]",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("'with' or 'without'");
  });

  it("rejects non-existent eval_id", () => {
    const r = omcc_eval_score(db, {
      eval_id: "nonexistent",
      arm: "with",
      test_case_id: "t1",
      grader_results: "[]",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not found");
  });

  it("rejects invalid JSON grader_results", () => {
    const evalId = createTestEval();
    const r = omcc_eval_score(db, {
      eval_id: evalId,
      arm: "with",
      test_case_id: "t1",
      grader_results: "bad json",
    });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MCP tool: omcc_eval_report
// ---------------------------------------------------------------------------

describe("omcc_eval_report", () => {
  function setupFullEval(): string {
    const cr = omcc_eval_create(db, {
      skill_name: "test-skill",
      test_cases: JSON.stringify([
        { id: "t1", prompt: "task 1" },
        { id: "t2", prompt: "task 2" },
      ]),
      graders: JSON.stringify([{ type: "exit-code", weight: 1.0, params: {} }]),
    });
    const evalId = (cr.data as { eval_id: string }).eval_id;

    // With-skill: t1 passes, t2 passes
    omcc_eval_score(db, {
      eval_id: evalId, arm: "with", test_case_id: "t1",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: true, weight: 1.0 }]),
    });
    omcc_eval_score(db, {
      eval_id: evalId, arm: "with", test_case_id: "t2",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: true, weight: 1.0 }]),
    });

    // Without-skill: t1 passes, t2 fails
    omcc_eval_score(db, {
      eval_id: evalId, arm: "without", test_case_id: "t1",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: true, weight: 1.0 }]),
    });
    omcc_eval_score(db, {
      eval_id: evalId, arm: "without", test_case_id: "t2",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: false, weight: 1.0 }]),
    });

    return evalId;
  }

  it("computes delta and grade correctly", () => {
    const evalId = setupFullEval();
    const r = omcc_eval_report(db, { eval_id: evalId });
    expect(r.ok).toBe(true);
    const data = r.data as EvalResult & { report: string };
    expect(data.with_skill_score).toBe(1.0);
    expect(data.without_skill_score).toBe(0.5);
    expect(data.delta).toBe(0.5);
    expect(data.grade).toBe("A");
    expect(data.report).toContain("test-skill");
  });

  it("includes test results per test case", () => {
    const evalId = setupFullEval();
    const r = omcc_eval_report(db, { eval_id: evalId });
    const data = r.data as EvalResult;
    expect(data.test_results).toHaveLength(2);
    const t1 = data.test_results.find((t) => t.test_case_id === "t1");
    expect(t1?.with_score).toBe(1.0);
    expect(t1?.without_score).toBe(1.0);
  });

  it("persists results to skill_evals table", () => {
    const evalId = setupFullEval();
    omcc_eval_report(db, { eval_id: evalId });
    const row = db.raw.prepare("SELECT grade, delta FROM skill_evals WHERE id = ?").get(evalId) as { grade: string; delta: number };
    expect(row.grade).toBe("A");
    expect(row.delta).toBe(0.5);
  });

  it("rejects missing eval_id", () => {
    const r = omcc_eval_report(db, { eval_id: "" });
    expect(r.ok).toBe(false);
  });

  it("rejects non-existent eval_id", () => {
    const r = omcc_eval_report(db, { eval_id: "nope" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Perfect scores (delta = 0, grade = C)
// ---------------------------------------------------------------------------

describe("perfect scores on both arms", () => {
  it("delta = 0 when both arms score equally", () => {
    const cr = omcc_eval_create(db, {
      skill_name: "neutral-skill",
      test_cases: JSON.stringify([{ id: "t1", prompt: "p" }]),
      graders: JSON.stringify([{ type: "exit-code", weight: 1.0, params: {} }]),
    });
    const evalId = (cr.data as { eval_id: string }).eval_id;

    omcc_eval_score(db, {
      eval_id: evalId, arm: "with", test_case_id: "t1",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: true, weight: 1.0 }]),
    });
    omcc_eval_score(db, {
      eval_id: evalId, arm: "without", test_case_id: "t1",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: true, weight: 1.0 }]),
    });

    const r = omcc_eval_report(db, { eval_id: evalId });
    const data = r.data as EvalResult;
    expect(data.delta).toBe(0);
    expect(data.grade).toBe("C");
  });
});

// ---------------------------------------------------------------------------
// Negative delta (grade = F)
// ---------------------------------------------------------------------------

describe("negative delta", () => {
  it("grades F when skill hurts performance", () => {
    const cr = omcc_eval_create(db, {
      skill_name: "bad-skill",
      test_cases: JSON.stringify([{ id: "t1", prompt: "p" }]),
      graders: JSON.stringify([{ type: "exit-code", weight: 1.0, params: {} }]),
    });
    const evalId = (cr.data as { eval_id: string }).eval_id;

    // With skill: fails
    omcc_eval_score(db, {
      eval_id: evalId, arm: "with", test_case_id: "t1",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: false, weight: 1.0 }]),
    });
    // Without skill: passes
    omcc_eval_score(db, {
      eval_id: evalId, arm: "without", test_case_id: "t1",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: true, weight: 1.0 }]),
    });

    const r = omcc_eval_report(db, { eval_id: evalId });
    const data = r.data as EvalResult;
    expect(data.delta).toBe(-1.0);
    expect(data.grade).toBe("F");
  });
});

// ---------------------------------------------------------------------------
// MCP tool: omcc_eval_history
// ---------------------------------------------------------------------------

describe("omcc_eval_history", () => {
  function createAndComplete(skillName: string): void {
    const cr = omcc_eval_create(db, {
      skill_name: skillName,
      test_cases: JSON.stringify([{ id: "t1", prompt: "p" }]),
      graders: JSON.stringify([{ type: "exit-code", weight: 1.0, params: {} }]),
    });
    const evalId = (cr.data as { eval_id: string }).eval_id;
    omcc_eval_score(db, {
      eval_id: evalId, arm: "with", test_case_id: "t1",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: true, weight: 1.0 }]),
    });
    omcc_eval_score(db, {
      eval_id: evalId, arm: "without", test_case_id: "t1",
      grader_results: JSON.stringify([{ grader_type: "exit-code", passed: false, weight: 1.0 }]),
    });
    omcc_eval_report(db, { eval_id: evalId });
  }

  it("returns empty array when no evals exist", () => {
    const r = omcc_eval_history(db, {});
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([]);
  });

  it("returns all completed evals", () => {
    createAndComplete("skill-a");
    createAndComplete("skill-b");
    const r = omcc_eval_history(db, {});
    const data = r.data as Array<{ skill_name: string }>;
    expect(data).toHaveLength(2);
  });

  it("filters by skill_name", () => {
    createAndComplete("skill-a");
    createAndComplete("skill-b");
    const r = omcc_eval_history(db, { skill_name: "skill-a" });
    const data = r.data as Array<{ skill_name: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].skill_name).toBe("skill-a");
  });

  it("does not return incomplete evals (no grade)", () => {
    omcc_eval_create(db, {
      skill_name: "incomplete",
      test_cases: JSON.stringify([{ id: "t1", prompt: "p" }]),
      graders: JSON.stringify([{ type: "exit-code", weight: 1.0, params: {} }]),
    });
    const r = omcc_eval_history(db, {});
    expect((r.data as unknown[]).length).toBe(0);
  });
});
