// mcp-server/src/fitness.ts
// Deterministic quality scoring -- computes a 0.0-1.0 fitness score from
// pre-computed build/lint/test results and file-content scans. No shell
// commands are executed; the calling skill orchestrates command execution
// and feeds results here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FitnessInput {
  project_root?: string;
  changed_files?: string[];
  build_cmd?: string;
  build_exit_code?: number;
  lint_cmd?: string;
  lint_exit_code?: number;
  lint_error_count?: number;
  test_cmd?: string;
  test_exit_code?: number;
  test_passed?: number;
  test_total?: number;
  format_cmd?: string;
  format_exit_code?: number;
}

export interface ComponentScore {
  score: number;
  weight: number;
  detail: string;
}

export interface FitnessResult {
  score: number;
  grade: "REJECT" | "WARN" | "PASS";
  components: {
    build_health: ComponentScore;
    lint_clean: ComponentScore;
    test_pass: ComponentScore;
    no_debug: ComponentScore;
    format_check: ComponentScore;
    no_todos: ComponentScore;
    security: ComponentScore;
  };
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Weights -- must sum to 1.0
// ---------------------------------------------------------------------------

const WEIGHTS = {
  build_health: 0.20,
  lint_clean: 0.20,
  test_pass: 0.25,
  no_debug: 0.10,
  format_check: 0.10,
  no_todos: 0.10,
  security: 0.05,
} as const;

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

export const DEBUG_PATTERNS = [
  /\bconsole\.log\b/,
  /\bconsole\.debug\b/,
  /\bconsole\.warn\b/,
  /\bdebugger\b/,
  /\bDebug\.WriteLine\b/,
  /\bprint\s*\(/,
];

export const TODO_PATTERNS = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bHACK\b/,
  /\bXXX\b/,
];

export const SECRET_PATTERNS = [
  /API_KEY\s*[=:]/i,
  /SECRET_KEY\s*[=:]/i,
  /PASSWORD\s*[=:]/i,
  /PRIVATE_KEY\s*[=:]/i,
  /ACCESS_TOKEN\s*[=:]/i,
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
  /ghp_[A-Za-z0-9]{36}/,
  /sk-[A-Za-z0-9]{48}/,
];

// ---------------------------------------------------------------------------
// File scanning helpers
// ---------------------------------------------------------------------------

function readFileSafe(filePath: string, root: string): string | null {
  try {
    return readFileSync(resolve(root, filePath), "utf-8");
  } catch {
    return null;
  }
}

/** Count how many files match at least one pattern from the list. */
export function scanFiles(
  files: string[],
  root: string,
  patterns: RegExp[],
): { matchCount: number; matchedFiles: string[] } {
  let matchCount = 0;
  const matchedFiles: string[] = [];
  for (const file of files) {
    const content = readFileSafe(file, root);
    if (content === null) continue;
    for (const p of patterns) {
      if (p.test(content)) {
        matchCount++;
        matchedFiles.push(file);
        break;
      }
    }
  }
  return { matchCount, matchedFiles };
}

// ---------------------------------------------------------------------------
// Component scorers
// ---------------------------------------------------------------------------

function scoreBuild(input: FitnessInput): ComponentScore {
  if (input.build_cmd === undefined) {
    return { score: 0.5, weight: WEIGHTS.build_health, detail: "Build command not configured" };
  }
  if (input.build_exit_code === undefined) {
    return { score: 0.5, weight: WEIGHTS.build_health, detail: "Build not yet executed" };
  }
  const passed = input.build_exit_code === 0;
  return {
    score: passed ? 1.0 : 0.0,
    weight: WEIGHTS.build_health,
    detail: passed ? "Build succeeded" : `Build failed (exit code ${input.build_exit_code})`,
  };
}

function scoreLint(input: FitnessInput): ComponentScore {
  if (input.lint_cmd === undefined) {
    return { score: 0.5, weight: WEIGHTS.lint_clean, detail: "Lint command not configured" };
  }
  if (input.lint_exit_code === undefined) {
    return { score: 0.5, weight: WEIGHTS.lint_clean, detail: "Lint not yet executed" };
  }
  const passed = input.lint_exit_code === 0;
  if (passed) {
    return { score: 1.0, weight: WEIGHTS.lint_clean, detail: "No lint errors" };
  }
  const count = input.lint_error_count ?? 0;
  const detail = count > 0
    ? `${count} lint error${count === 1 ? "" : "s"} found`
    : `Lint failed (exit code ${input.lint_exit_code})`;
  return { score: 0.0, weight: WEIGHTS.lint_clean, detail };
}

function scoreTest(input: FitnessInput): ComponentScore {
  if (input.test_cmd === undefined) {
    return { score: 0.5, weight: WEIGHTS.test_pass, detail: "Test command not configured" };
  }
  if (input.test_exit_code === undefined) {
    return { score: 0.5, weight: WEIGHTS.test_pass, detail: "Tests not yet executed" };
  }
  if (input.test_total !== undefined && input.test_total > 0 && input.test_passed !== undefined) {
    const ratio = input.test_passed / input.test_total;
    const detail = `${input.test_passed}/${input.test_total} tests passed`;
    return { score: ratio, weight: WEIGHTS.test_pass, detail };
  }
  const passed = input.test_exit_code === 0;
  return {
    score: passed ? 1.0 : 0.0,
    weight: WEIGHTS.test_pass,
    detail: passed ? "All tests passed" : `Tests failed (exit code ${input.test_exit_code})`,
  };
}

function scoreNoDebug(input: FitnessInput): ComponentScore {
  const files = input.changed_files ?? [];
  const root = input.project_root ?? process.cwd();
  if (files.length === 0) {
    return { score: 1.0, weight: WEIGHTS.no_debug, detail: "No changed files to scan" };
  }
  const { matchCount, matchedFiles } = scanFiles(files, root, DEBUG_PATTERNS);
  if (matchCount === 0) {
    return { score: 1.0, weight: WEIGHTS.no_debug, detail: "No debug artifacts found" };
  }
  const score = Math.max(0, 1 - matchCount / files.length);
  const detail = `${matchCount} file${matchCount === 1 ? "" : "s"} with debug artifacts: ${matchedFiles.join(", ")}`;
  return { score, weight: WEIGHTS.no_debug, detail };
}

function scoreFormat(input: FitnessInput): ComponentScore {
  if (input.format_cmd === undefined) {
    return { score: 0.5, weight: WEIGHTS.format_check, detail: "Format check not configured" };
  }
  if (input.format_exit_code === undefined) {
    return { score: 0.5, weight: WEIGHTS.format_check, detail: "Format check not yet executed" };
  }
  const passed = input.format_exit_code === 0;
  return {
    score: passed ? 1.0 : 0.0,
    weight: WEIGHTS.format_check,
    detail: passed ? "Code is properly formatted" : "Format check failed",
  };
}

function scoreNoTodos(input: FitnessInput): ComponentScore {
  const files = input.changed_files ?? [];
  const root = input.project_root ?? process.cwd();
  if (files.length === 0) {
    return { score: 1.0, weight: WEIGHTS.no_todos, detail: "No changed files to scan" };
  }
  const { matchCount } = scanFiles(files, root, TODO_PATTERNS);
  if (matchCount === 0) {
    return { score: 1.0, weight: WEIGHTS.no_todos, detail: "No TODO/FIXME/HACK/XXX found" };
  }
  const score = Math.max(0, 1 - matchCount / files.length);
  const detail = `${matchCount} file${matchCount === 1 ? "" : "s"} with TODO/FIXME/HACK/XXX`;
  return { score, weight: WEIGHTS.no_todos, detail };
}

function scoreSecurity(input: FitnessInput): ComponentScore {
  const files = input.changed_files ?? [];
  const root = input.project_root ?? process.cwd();
  if (files.length === 0) {
    return { score: 1.0, weight: WEIGHTS.security, detail: "No changed files to scan" };
  }
  const { matchCount, matchedFiles } = scanFiles(files, root, SECRET_PATTERNS);
  if (matchCount === 0) {
    return { score: 1.0, weight: WEIGHTS.security, detail: "No security issues found" };
  }
  const detail = `Potential secrets in ${matchCount} file${matchCount === 1 ? "" : "s"}: ${matchedFiles.join(", ")}`;
  return { score: 0.0, weight: WEIGHTS.security, detail };
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

function gradeFromScore(score: number): "REJECT" | "WARN" | "PASS" {
  if (score < 0.4) return "REJECT";
  if (score <= 0.7) return "WARN";
  return "PASS";
}

export function computeFitnessScore(input: FitnessInput): FitnessResult {
  const components = {
    build_health: scoreBuild(input),
    lint_clean: scoreLint(input),
    test_pass: scoreTest(input),
    no_debug: scoreNoDebug(input),
    format_check: scoreFormat(input),
    no_todos: scoreNoTodos(input),
    security: scoreSecurity(input),
  };

  let totalScore = 0;
  for (const c of Object.values(components)) {
    totalScore += c.score * c.weight;
  }
  totalScore = Math.round(totalScore * 100) / 100;

  const grade = gradeFromScore(totalScore);
  const recommendation = `${grade} -- score ${totalScore.toFixed(2)} ${
    grade === "PASS" ? "exceeds" : grade === "WARN" ? "near" : "below"
  } threshold 0.70`;

  return { score: totalScore, grade, components, recommendation };
}