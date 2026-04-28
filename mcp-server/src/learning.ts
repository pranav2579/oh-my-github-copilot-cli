// mcp-server/src/learning.ts
// Continuous learning pipeline: extract, record, promote, and list patterns.

import type { OmccDb } from "./db.js";
import type { ToolResult } from "./tools.js";

function ok(data?: unknown): ToolResult {
  return { ok: true, data };
}
function err(error: string): ToolResult {
  return { ok: false, error };
}

const VALID_CATEGORIES = ["convention", "anti-pattern", "command", "architecture", "workflow"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

const SIGNAL_WORDS =
  /\b(always|never|should|must|convention|pattern|rule|prefer|avoid|don't|do not|ensure|require|important)\b/i;

/**
 * Extract candidate patterns from a session summary by splitting on sentence
 * boundaries and keeping sentences that contain signal words.
 */
export function extractPatterns(summary: string): { pattern: string; category: Category }[] {
  const sentences = summary
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  const candidates: { pattern: string; category: Category }[] = [];
  for (const sentence of sentences) {
    if (!SIGNAL_WORDS.test(sentence)) continue;
    candidates.push({ pattern: sentence, category: classifySentence(sentence) });
  }
  return candidates;
}

function classifySentence(s: string): Category {
  const lower = s.toLowerCase();
  if (/\b(never|avoid|don't|do not|anti[- ]?pattern)\b/.test(lower)) return "anti-pattern";
  if (/\b(run|execute|command|script|build|test|deploy)\b/.test(lower)) return "command";
  if (/\b(architect|module|layer|service|component|system)\b/.test(lower)) return "architecture";
  if (/\b(workflow|pipeline|process|step|phase|flow)\b/.test(lower)) return "workflow";
  return "convention";
}

function generateId(pattern: string): string {
  const slug = pattern
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  const hash = simpleHash(pattern);
  return `lp-${slug}-${hash}`;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

// --- MCP tool implementations ---

export function omcc_learn_extract(
  _db: OmccDb,
  args: { session_summary: string }
): ToolResult {
  if (!args?.session_summary) return err("session_summary required");
  const candidates = extractPatterns(args.session_summary);
  if (candidates.length === 0) {
    return ok({ candidates: [], message: "No patterns detected. Try including signal words (always, never, should, must, convention, pattern, rule)." });
  }
  const result = candidates.map((c) => ({
    id: generateId(c.pattern),
    pattern: c.pattern,
    category: c.category,
    confidence: 0.3,
  }));
  return ok({ candidates: result });
}

export function omcc_learn_record(
  db: OmccDb,
  args: { pattern: string; category: string; confidence?: number }
): ToolResult {
  if (!args?.pattern) return err("pattern required");
  if (!args?.category) return err("category required");
  if (!VALID_CATEGORIES.includes(args.category as Category)) {
    return err(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  const confidence = Math.max(0, Math.min(1, args.confidence ?? 0.3));
  const id = generateId(args.pattern);

  const existing = db.raw
    .prepare("SELECT id, confidence, occurrences FROM learned_patterns WHERE id = ?")
    .get(id) as { id: string; confidence: number; occurrences: number } | undefined;

  if (existing) {
    const newConf = Math.min(1.0, existing.confidence + 0.1);
    db.raw
      .prepare(
        "UPDATE learned_patterns SET confidence = ?, occurrences = occurrences + 1, last_seen = datetime('now') WHERE id = ?"
      )
      .run(newConf, id);
    return ok({
      id,
      confidence: newConf,
      occurrences: existing.occurrences + 1,
      updated: true,
    });
  }

  db.raw
    .prepare(
      "INSERT INTO learned_patterns (id, pattern, category, confidence, source, occurrences) VALUES (?, ?, ?, ?, 'manual', 1)"
    )
    .run(id, args.pattern, args.category, confidence);
  return ok({ id, confidence, occurrences: 1, updated: false });
}

export function omcc_learn_promote(
  db: OmccDb,
  args: { id: string; target: string }
): ToolResult {
  if (!args?.id) return err("id required");
  if (!args?.target || !["L1", "L2"].includes(args.target)) {
    return err("target must be 'L1' or 'L2'");
  }

  const row = db.raw
    .prepare("SELECT id, confidence, promoted_to FROM learned_patterns WHERE id = ?")
    .get(args.id) as { id: string; confidence: number; promoted_to: string | null } | undefined;

  if (!row) return err(`pattern '${args.id}' not found`);
  if (row.confidence < 0.7) {
    return err(
      `confidence ${row.confidence.toFixed(2)} is below promotion threshold 0.70`
    );
  }

  db.raw
    .prepare("UPDATE learned_patterns SET promoted_to = ? WHERE id = ?")
    .run(args.target, args.id);
  return ok({ id: args.id, promoted_to: args.target });
}

export function omcc_learn_list(
  db: OmccDb,
  args: { category?: string; min_confidence?: number }
): ToolResult {
  const minConf = args?.min_confidence ?? 0.0;
  let sql =
    "SELECT id, pattern, category, confidence, source, occurrences, last_seen, promoted_to, created_at FROM learned_patterns WHERE confidence >= ?";
  const params: (string | number)[] = [minConf];

  if (args?.category) {
    sql += " AND category = ?";
    params.push(args.category);
  }
  sql += " ORDER BY confidence DESC";

  const rows = db.raw.prepare(sql).all(...params);
  return ok(rows);
}

// Tool registry for learning tools
export const LEARNING_TOOLS = {
  omcc_learn_extract,
  omcc_learn_record,
  omcc_learn_promote,
  omcc_learn_list,
} as const;

export type LearningToolName = keyof typeof LEARNING_TOOLS;
