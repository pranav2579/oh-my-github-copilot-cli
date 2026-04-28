// mcp-server/src/skill-eval.ts
// Dual-arm A/B evaluation framework for skills. Measures whether a skill
// actually improves agent performance by comparing WITH-skill vs WITHOUT
// (baseline) scores across configurable graders.

import type { OmccDb } from "./db.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestCase {
  id: string;
  prompt: string;
  expected?: string;
  assertions?: string[];
}

export interface Grader {
  type: "string-match" | "regex" | "file-exists" | "exit-code" | "contains";
  weight: number;
  params: Record<string, string>;
}

export interface EvalConfig {
  skill_name: string;
  test_cases: TestCase[];
  graders: Grader[];
  trials_per_case: number;
}

export interface GraderResult {
  grader_type: string;
  passed: boolean;
  weight: number;
  detail?: string;
}

export interface TestCaseResult {
  test_case_id: string;
  with_score: number;
  without_score: number;
  grader_results_with: GraderResult[];
  grader_results_without: GraderResult[];
}

export interface EvalResult {
  skill_name: string;
  with_skill_score: number;
  without_skill_score: number;
  delta: number;
  grade: "A" | "B" | "C" | "F";
  test_results: TestCaseResult[];
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function ensureEvalTables(db: OmccDb): void {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS skill_evals (
      id TEXT PRIMARY KEY,
      skill_name TEXT NOT NULL,
      config TEXT NOT NULL,
      with_score REAL,
      without_score REAL,
      delta REAL,
      grade TEXT,
      details TEXT,
      evaluated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS eval_scores (
      eval_id TEXT NOT NULL,
      arm TEXT NOT NULL CHECK(arm IN ('with', 'without')),
      test_case_id TEXT NOT NULL,
      grader_results TEXT NOT NULL,
      score REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (eval_id, arm, test_case_id),
      FOREIGN KEY (eval_id) REFERENCES skill_evals(id) ON DELETE CASCADE
    );
  `);
}

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

export function createEvalConfig(
  skillName: string,
  testCases: TestCase[],
  graders?: Grader[],
  trialsPerCase?: number,
): EvalConfig {
  return {
    skill_name: skillName,
    test_cases: testCases,
    graders: graders ?? [
      { type: "exit-code", weight: 1.0, params: { expected: "0" } },
    ],
    trials_per_case: trialsPerCase ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Weighted average of grader results. Returns 0.0-1.0. */
export function computeScore(results: GraderResult[]): number {
  if (results.length === 0) return 0;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const r of results) {
    weightedSum += (r.passed ? 1.0 : 0.0) * r.weight;
    totalWeight += r.weight;
  }
  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Grade thresholds based on delta (with_score - without_score):
 *   A: delta >= +0.30 (skill clearly helps)
 *   B: delta >= +0.15 (skill moderately helps)
 *   C: delta >= 0.00  (skill doesn't hurt)
 *   F: delta < 0.00   (skill makes things worse)
 */
export function computeGrade(delta: number): "A" | "B" | "C" | "F" {
  if (delta >= 0.30) return "A";
  if (delta >= 0.15) return "B";
  if (delta >= 0.00) return "C";
  return "F";
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

export function generateReport(result: EvalResult): string {
  const lines: string[] = [];
  lines.push(`# Skill Evaluation Report: ${result.skill_name}`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push(`- **Grade**: ${result.grade}`);
  lines.push(`- **With skill**: ${result.with_skill_score.toFixed(3)}`);
  lines.push(`- **Without skill (baseline)**: ${result.without_skill_score.toFixed(3)}`);
  lines.push(`- **Delta**: ${result.delta >= 0 ? "+" : ""}${result.delta.toFixed(3)}`);
  lines.push("");

  lines.push(`## Grade Interpretation`);
  switch (result.grade) {
    case "A":
      lines.push("Skill clearly helps. Keep and promote.");
      break;
    case "B":
      lines.push("Skill moderately helps. Keep, consider improving.");
      break;
    case "C":
      lines.push("Skill is neutral. Review if worth the token cost.");
      break;
    case "F":
      lines.push("Skill hurts performance. Investigate and fix or remove.");
      break;
  }
  lines.push("");

  if (result.test_results.length > 0) {
    lines.push(`## Test Case Results`);
    lines.push("| Test Case | With Score | Without Score | Delta |");
    lines.push("|---|---|---|---|");
    for (const tc of result.test_results) {
      const d = tc.with_score - tc.without_score;
      lines.push(
        `| ${tc.test_case_id} | ${tc.with_score.toFixed(3)} | ${tc.without_score.toFixed(3)} | ${d >= 0 ? "+" : ""}${d.toFixed(3)} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// MCP tool implementations
// ---------------------------------------------------------------------------

function generateId(): string {
  return `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function omcc_eval_create(
  db: OmccDb,
  args: { skill_name: string; test_cases: string; graders: string },
): { ok: boolean; data?: unknown; error?: string } {
  if (!args?.skill_name) return { ok: false, error: "skill_name required" };
  if (!args?.test_cases) return { ok: false, error: "test_cases required" };
  if (!args?.graders) return { ok: false, error: "graders required" };

  let testCases: TestCase[];
  let graders: Grader[];
  try {
    testCases = JSON.parse(args.test_cases);
    graders = JSON.parse(args.graders);
  } catch {
    return { ok: false, error: "test_cases and graders must be valid JSON arrays" };
  }

  if (!Array.isArray(testCases) || testCases.length === 0) {
    return { ok: false, error: "test_cases must be a non-empty array" };
  }
  if (!Array.isArray(graders) || graders.length === 0) {
    return { ok: false, error: "graders must be a non-empty array" };
  }

  ensureEvalTables(db);

  const config = createEvalConfig(args.skill_name, testCases, graders);
  const id = generateId();

  db.raw
    .prepare("INSERT INTO skill_evals (id, skill_name, config) VALUES (?, ?, ?)")
    .run(id, args.skill_name, JSON.stringify(config));

  return { ok: true, data: { eval_id: id, config } };
}

export function omcc_eval_score(
  db: OmccDb,
  args: { eval_id: string; arm: string; test_case_id: string; grader_results: string },
): { ok: boolean; data?: unknown; error?: string } {
  if (!args?.eval_id) return { ok: false, error: "eval_id required" };
  if (!args?.arm || (args.arm !== "with" && args.arm !== "without")) {
    return { ok: false, error: "arm must be 'with' or 'without'" };
  }
  if (!args?.test_case_id) return { ok: false, error: "test_case_id required" };
  if (!args?.grader_results) return { ok: false, error: "grader_results required" };

  let graderResults: GraderResult[];
  try {
    graderResults = JSON.parse(args.grader_results);
  } catch {
    return { ok: false, error: "grader_results must be valid JSON" };
  }

  if (!Array.isArray(graderResults)) {
    return { ok: false, error: "grader_results must be an array" };
  }

  ensureEvalTables(db);

  const evalRow = db.raw
    .prepare("SELECT id FROM skill_evals WHERE id = ?")
    .get(args.eval_id) as { id: string } | undefined;

  if (!evalRow) {
    return { ok: false, error: `eval_id '${args.eval_id}' not found` };
  }

  const score = computeScore(graderResults);

  db.raw
    .prepare(
      "INSERT INTO eval_scores (eval_id, arm, test_case_id, grader_results, score) " +
        "VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(eval_id, arm, test_case_id) DO UPDATE SET " +
        "grader_results = excluded.grader_results, score = excluded.score, created_at = datetime('now')",
    )
    .run(args.eval_id, args.arm, args.test_case_id, JSON.stringify(graderResults), score);

  return { ok: true, data: { eval_id: args.eval_id, arm: args.arm, test_case_id: args.test_case_id, score } };
}

export function omcc_eval_report(
  db: OmccDb,
  args: { eval_id: string },
): { ok: boolean; data?: unknown; error?: string } {
  if (!args?.eval_id) return { ok: false, error: "eval_id required" };

  ensureEvalTables(db);

  const evalRow = db.raw
    .prepare("SELECT id, skill_name, config FROM skill_evals WHERE id = ?")
    .get(args.eval_id) as { id: string; skill_name: string; config: string } | undefined;

  if (!evalRow) {
    return { ok: false, error: `eval_id '${args.eval_id}' not found` };
  }

  const scores = db.raw
    .prepare("SELECT arm, test_case_id, grader_results, score FROM eval_scores WHERE eval_id = ?")
    .all(args.eval_id) as Array<{ arm: string; test_case_id: string; grader_results: string; score: number }>;

  const testCaseIds = [...new Set(scores.map((s) => s.test_case_id))];

  const testResults: TestCaseResult[] = testCaseIds.map((tcId) => {
    const withRow = scores.find((s) => s.test_case_id === tcId && s.arm === "with");
    const withoutRow = scores.find((s) => s.test_case_id === tcId && s.arm === "without");
    return {
      test_case_id: tcId,
      with_score: withRow?.score ?? 0,
      without_score: withoutRow?.score ?? 0,
      grader_results_with: withRow ? JSON.parse(withRow.grader_results) : [],
      grader_results_without: withoutRow ? JSON.parse(withoutRow.grader_results) : [],
    };
  });

  const withScores = testResults.map((t) => t.with_score);
  const withoutScores = testResults.map((t) => t.without_score);

  const withAvg = withScores.length > 0 ? withScores.reduce((a, b) => a + b, 0) / withScores.length : 0;
  const withoutAvg = withoutScores.length > 0 ? withoutScores.reduce((a, b) => a + b, 0) / withoutScores.length : 0;
  const delta = Math.round((withAvg - withoutAvg) * 1000) / 1000;
  const grade = computeGrade(delta);

  const result: EvalResult = {
    skill_name: evalRow.skill_name,
    with_skill_score: Math.round(withAvg * 1000) / 1000,
    without_skill_score: Math.round(withoutAvg * 1000) / 1000,
    delta,
    grade,
    test_results: testResults,
  };

  const report = generateReport(result);

  db.raw
    .prepare(
      "UPDATE skill_evals SET with_score = ?, without_score = ?, delta = ?, grade = ?, details = ?, evaluated_at = datetime('now') WHERE id = ?",
    )
    .run(result.with_skill_score, result.without_skill_score, result.delta, result.grade, JSON.stringify(result), args.eval_id);

  return { ok: true, data: { ...result, report } };
}

export function omcc_eval_history(
  db: OmccDb,
  args: { skill_name?: string },
): { ok: boolean; data?: unknown; error?: string } {
  ensureEvalTables(db);

  let rows;
  if (args?.skill_name) {
    rows = db.raw
      .prepare(
        "SELECT id, skill_name, with_score, without_score, delta, grade, evaluated_at " +
          "FROM skill_evals WHERE skill_name = ? AND grade IS NOT NULL ORDER BY evaluated_at DESC",
      )
      .all(args.skill_name);
  } else {
    rows = db.raw
      .prepare(
        "SELECT id, skill_name, with_score, without_score, delta, grade, evaluated_at " +
          "FROM skill_evals WHERE grade IS NOT NULL ORDER BY evaluated_at DESC",
      )
      .all();
  }

  return { ok: true, data: rows };
}
